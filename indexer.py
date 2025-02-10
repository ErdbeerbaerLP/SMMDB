import asyncio
import hashlib
import hmac
import io
import json
import logging
import multiprocessing
import os
import struct
import time

import anyio
import mariadb
from anynet import http
from mariadb import Connection
from nintendo import nnas
from nintendo.nex import backend, settings, streams, common, rmc
from nintendo.nex import datastore_smm
from nintendo.nex.authentication import AuthenticationInfo
from nintendo.nex.common import logger

from decompress import Course

cli: datastore_smm.DataStoreClientSMM = None  # * Gets set later
connection: Connection = None

logging.basicConfig(level=logging.INFO)


class DataStoreCustomRankingResult(common.Structure):
    def __init__(self):
        super().__init__()
        self.order = None
        self.score = None
        self.metaInfo: datastore_smm.DataStoreMetaInfo = None

    def check_required(self, settings, version):
        for field in ['order', 'score', 'metaInfo']:
            if getattr(self, field) is None:
                raise ValueError("No value assigned to required field: %s" % field)

    def load(self, stream, version):
        self.order = stream.u32()
        self.score = stream.u32()
        self.metaInfo = stream.extract(datastore_smm.DataStoreMetaInfo)

    def save(self, stream, version):
        self.check_required(stream.settings, version)
        stream.u32(self.order)
        stream.u32(self.score)
        stream.add(self.metaInfo)


class DataStoreSearchParam(common.Structure):
    def __init__(self):
        super().__init__()
        self.search_target = 1
        self.owner_ids = []
        self.owner_type = 0
        self.destination_ids = []
        self.data_type = 65535
        self.created_after = common.DateTime(671076024059)
        self.created_before = common.DateTime(671076024059)
        self.updated_after = common.DateTime(671076024059)
        self.updated_before = common.DateTime(671076024059)
        self.refer_data_id = 0
        self.tags = []
        self.result_order_column = 0
        self.result_order = 0
        self.result_range = common.ResultRange()
        self.result_option = 0
        self.minimal_rating_frequency = 0
        self.use_cache = False
        self.data_types = []

    def check_required(self, settings, version):
        pass

    def load(self, stream, version):
        self.search_target = stream.u8()
        self.owner_ids = stream.list(stream.pid)
        self.owner_type = stream.u8()
        self.destination_ids = stream.list(stream.u64)
        self.data_type = stream.u16()
        self.created_after = stream.datetime()
        self.created_before = stream.datetime()
        self.updated_after = stream.datetime()
        self.updated_before = stream.datetime()
        self.refer_data_id = stream.u32()
        self.tags = stream.list(stream.string)
        self.result_order_column = stream.u8()
        self.result_order = stream.u8()
        self.result_range = stream.extract(common.ResultRange)
        self.result_option = stream.u8()
        self.minimal_rating_frequency = stream.u32()
        self.use_cache = stream.bool()
        self.data_types = stream.list(stream.u16)

    def save(self, stream, version):
        self.check_required(stream.settings, version)
        stream.u8(self.search_target)
        stream.list(self.owner_ids, stream.pid)
        stream.u8(self.owner_type)
        stream.list(self.destination_ids, stream.u64)
        stream.u16(self.data_type)
        stream.datetime(self.created_after)
        stream.datetime(self.created_before)
        stream.datetime(self.updated_after)
        stream.datetime(self.updated_before)
        stream.u32(self.refer_data_id)
        stream.list(self.tags, stream.string)
        stream.u8(self.result_order_column)
        stream.u8(self.result_order)
        stream.add(self.result_range)
        stream.u8(self.result_option)
        stream.u32(self.minimal_rating_frequency)
        stream.bool(self.use_cache)
        stream.list(self.data_types, stream.u16)


class DataStoreGetCourseRecordResult(common.Structure):
    def __init__(self):
        super().__init__()
        self.data_id = None
        self.slot = None
        self.first_pid = None
        self.best_pid = None
        self.best_score = None
        self.created_time = None
        self.updated_time = None

    def load(self, stream: streams.StreamIn, version: int):
        self.data_id = stream.u64()
        self.slot = stream.u8()
        self.first_pid = stream.u32()
        self.best_pid = stream.u32()
        self.best_score = stream.s32()
        self.created_time = stream.datetime()
        self.updated_time = stream.datetime()

    def save(self, stream: streams.StreamIn, version: int):
        stream.u64(self.data_id)
        stream.u8(self.slot)
        stream.u32(self.first_pid)
        stream.u32(self.best_pid)
        stream.s32(self.best_score)
        stream.datetime(self.created_time)
        stream.datetime(self.updated_time)


async def getCourses(cli, param):
    logger.info("DataStoreClient.search_object()")
    # --- request ---
    stream = streams.StreamOut(cli.settings)
    stream.add(param)
    l: list = ["", "", "", "0", "0"]
    stream.list(l, stream.string)

    data = await cli.client.request(cli.PROTOCOL_ID, 0x42, stream.get())

    # --- response ---
    stream = streams.StreamIn(data, cli.settings)
    result = stream.list(DataStoreCustomRankingResult)
    if not stream.eof():
        raise ValueError(
            "Response is bigger than expected (got %i bytes, but only %i were read)" % (stream.size(), stream.tell()))
    logger.info("DataStoreClient.search_object -> done")
    return result


class DataStoreGetCustomRankingByDataIdParam(common.Structure):
    def __init__(self):
        super().__init__()
        self.application_id = None
        self.data_id_list = None
        self.result_option = None

    def load(self, stream: streams.StreamIn, version: int):
        self.application_id = stream.u32()
        self.data_id_list = stream.list(stream.u64)
        self.result_option = stream.u8()

    def save(self, stream: streams.StreamIn, version: int):
        stream.u32(self.application_id)
        stream.list(self.data_id_list, stream.u64)
        stream.u8(self.result_option)


class DataStoreGetCourseRecordParam(common.Structure):
    def __init__(self):
        super().__init__()
        self.data_id = None
        self.slot = None

    def load(self, stream: streams.StreamIn, version: int):
        self.data_id = stream.u64()
        self.slot = stream.u8()

    def save(self, stream: streams.StreamIn, version: int):
        stream.u64(self.data_id)
        stream.u8(self.slot)


async def get_course_record(param: DataStoreGetCourseRecordParam) -> DataStoreGetCourseRecordResult:
    # * --- request ---
    stream = streams.StreamOut(cli.settings)
    stream.add(param)
    data = await cli.client.request(cli.PROTOCOL_ID, 72, stream.get())

    # * --- response ---
    stream = streams.StreamIn(data, cli.settings)

    result = stream.extract(DataStoreGetCourseRecordResult)

    return result


class BufferQueueParam(common.Structure):
    def __init__(self):
        super().__init__()
        self.data_id = None
        self.slot = None

    def load(self, stream: streams.StreamIn, version: int):
        self.data_id = stream.u64()
        self.slot = stream.u32()

    def save(self, stream: streams.StreamIn, version: int):
        stream.u64(self.data_id)
        stream.u32(self.slot)


async def get_buffer_queue(param: BufferQueueParam) -> list[bytes]:
    # * --- request ---
    stream = streams.StreamOut(cli.settings)
    stream.add(param)
    data = await cli.client.request(cli.PROTOCOL_ID, 54, stream.get())

    # * --- response ---
    stream = streams.StreamIn(data, cli.settings)

    result = stream.list(stream.qbuffer)

    return result


async def get_custom_ranking_by_data_id(param: DataStoreGetCustomRankingByDataIdParam) -> rmc.RMCResponse:
    # * --- request ---
    stream = streams.StreamOut(cli.settings)
    stream.add(param)
    data = await cli.client.request(cli.PROTOCOL_ID, 50, stream.get())

    # * --- response ---
    stream = streams.StreamIn(data, cli.settings)

    obj = rmc.RMCResponse()
    obj.ranking_result = stream.list(DataStoreCustomRankingResult)
    obj.results = stream.list(common.Result)

    return obj


async def download_object_buffer_queues(buffer_queues: list[dict], data_id: int, slot: int):
    logger.info("download_object_buffer_queues()")
    try:
        param = BufferQueueParam()
        param.data_id = data_id
        param.slot = slot

        response = await get_buffer_queue(param)

        buffer_queues.append({
            "slot": slot,
            "buffers": [buffer.hex() for buffer in response]
        })

        logger.info("download_object_buffer_queues() -> Done")
    except:

        logger.info("download_object_buffer_queues() -> Empty, Done")
        # * Eat errors
        # * SMM will throw errors if an object has no buffers in the slot
        return


async def download_object_custom_ranking(custom_rankings: list[dict], data_id: int, application_id: int):
    try:
        param = DataStoreGetCustomRankingByDataIdParam()
        param.application_id = application_id
        param.data_id_list = [data_id]
        param.result_option = 0

        response = await get_custom_ranking_by_data_id(param)

        custom_rankings.append({
            "application_id": application_id,
            "score": response.ranking_result[0].score
        })
    except:
        # * Eat errors
        # * SMM will throw errors if an object has no ranking in the application ID
        return


def getLevelCode(OBJECT_DATA_ID):
    SMM_GAME_SERVER_ACCESS_KEY = b"9f2b4678"
    OBJECT_DATA_ID_HEX = f"{OBJECT_DATA_ID:012X}"

    key = hashlib.md5(SMM_GAME_SERVER_ACCESS_KEY).digest()
    data = struct.pack("<Q", OBJECT_DATA_ID)
    checksum = hmac.new(key=key, msg=data, digestmod=hashlib.md5).digest()
    checksum = checksum[3:1:-1].hex().upper()

    return f"{checksum.zfill(4)}-{OBJECT_DATA_ID_HEX[0:4]}-{OBJECT_DATA_ID_HEX[4:8]}-{OBJECT_DATA_ID_HEX[8:12]}"  # 2087-FFFF-FFFF-FFFF


async def download_course_record(course_records: list[dict], data_id: int, slot: int):
    # * This is expected to fail OFTEN
    # * Only course objects have records
    logger.info("download_course_record()")
    try:
        param = DataStoreGetCourseRecordParam()
        param.data_id = data_id
        param.slot = slot

        response = await get_course_record(param)

        course_records.append({
            "slot": response.slot,
            "first_pid": response.first_pid,
            "best_pid": response.best_pid,
            "best_score": response.best_score,
            "created_time": {
                'original_value': response.created_time.value(),
                'standard': response.created_time.standard_datetime().strftime("%Y-%m-%d %H:%M:%S")
            },
            "updated_time": {
                'original_value': response.updated_time.value(),
                'standard': response.updated_time.standard_datetime().strftime("%Y-%m-%d %H:%M:%S")
            }
        })
        logger.info("download_course_record() -> Done")
    except:

        logger.info("download_course_record() -> Empty, Done")
        # * Eat errors
        # * SMM will throw errors if an object has no record in the slot
        return


async def writeFile(path: str, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, 'wb') as file:
        file.write(json.dumps(data).encode("utf-8"))
        file.close()


def should_download_object(data_id, size, object_version):
    return True


KNOWN_BUFFER_QUEUE_SLOTS = [2]
#KNOWN_BUFFER_QUEUE_SLOTS = [0, 2, 3, 1, 4]
KNOWN_COURSE_RECORD_SLOTS = [0]
KNOWN_CUSTOM_RANKING_APPLICATION_IDS = [
    0,
    2400,
    3600,
    200000000,
    200002400,
    200003600,
    300000000,
    300002400,
    300003600,
]


async def process_datastore_object(obj: datastore_smm.DataStoreMetaInfo):
    param = datastore_smm.DataStorePrepareGetParam()
    param.data_id = obj.data_id

    get_object_response = await cli.prepare_get_object(param)
    s3_headers = {header.key: header.value for header in get_object_response.headers}
    s3_url = get_object_response.url
    data_id = get_object_response.data_id
    object_version = 0  # int(s3_url.split('/')[-1].split('-')[1].split('?')[0])

    if not should_download_object(data_id, get_object_response.size, object_version):
        # * Object data already downloaded
        print("Skipping %d" % data_id)
        return

    buffer_queues = []

    async with anyio.create_task_group() as tg:
        for slot in KNOWN_BUFFER_QUEUE_SLOTS:
            tg.start_soon(download_object_buffer_queues, buffer_queues, data_id, slot)

    # custom_rankings = []

    # async with anyio.create_task_group() as tg:
    ##    for application_id in KNOWN_CUSTOM_RANKING_APPLICATION_IDS:
    #        tg.start_soon(download_object_custom_ranking, custom_rankings, data_id, application_id)

    course_records = []
    async with anyio.create_task_group() as tg:
        for slot in KNOWN_COURSE_RECORD_SLOTS:
            tg.start_soon(download_course_record, course_records, data_id, slot)

    s3_response = await http.get(s3_url, headers=s3_headers)

    course = Course(s3_response.body)

    await updateUserInDB(obj.owner_id)

    if len(course_records) > 0:
        print("Updating record users...")
        print(course_records[0])
        await updateUserInDB(course_records[0]["first_pid"])
        await updateUserInDB(course_records[0]["best_pid"])

    updateLevelInDB(obj, course, course_records, buffer_queues)


async def updateUserInDB(pid):
    nas = nnas.NNASClient()
    mii = await nas.get_mii(pid)
    sql = "INSERT INTO users (pid, name, pnid) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name = VALUES(name), pnid = VALUES(pnid)"
    data = (pid, mii.name, mii.nnid)

    connection.cursor().execute(sql, data)

    connection.commit()

async def fetchRandomLevels(DEVICE_ID, SERIAL_NUMBER, SYSTEM_VERSION, REGION_ID, COUNTRY_NAME,
                            LANGUAGE, USERNAME, PASSWORD, CERT):
    TITLE_ID = 0x000500001018DB00
    TITLE_VERSION = 272
    ACCESS_KEY = "9f2b4678"
    NEX_VERSION = 30803
    GAME_SERVER_ID = 0x1018DB00

    conn_params = {
        "user": os.getenv("SMMDB_DBUSER","smmdb"),
        "password": os.getenv("SMMDB_DBPASSWORD"),
        "host": os.getenv("SMMDB_DBIP"),
        "port": int(os.getenv("SMMDB_DBPORT", "3306")),
        "database": os.getenv("SMMDB_DBNAME", "smmdb")
    }
    global connection
    connection = mariadb.connect(**conn_params)
    try:
        nas = nnas.NNASClient()
        nas.set_device(DEVICE_ID, SERIAL_NUMBER, SYSTEM_VERSION, CERT)
        nas.set_title(TITLE_ID, TITLE_VERSION)
        nas.set_locale(REGION_ID, COUNTRY_NAME, LANGUAGE)

        access_token = await nas.login(USERNAME, PASSWORD, "hash")

        s = settings.default()
        s.configure(ACCESS_KEY, NEX_VERSION)

        nex_token = await nas.get_nex_token(access_token.token, GAME_SERVER_ID)
        async with backend.connect(s, nex_token.host, nex_token.port) as be:
            info = AuthenticationInfo()
            info.token = nex_token.token
            async with be.login(str(nex_token.pid), nex_token.password, info) as client:
                global cli
                cli = datastore_smm.DataStoreClientSMM(client)
                param = DataStoreSearchParam()
                param.result_range.size = int(os.getenv("SMMDB_MAXLEVELS", "20"))
                objects = await getCourses(cli, param)
                print("Found %d objects" % len(objects))
                async with anyio.create_task_group() as tg:
                    for o in objects:
                        tg.start_soon(run, o)
    except Exception as e:
        print(f"Server {hex(TITLE_ID)} down!")
        logging.exception(e)
        return False


async def run(obj):
    try:
        level: DataStoreCustomRankingResult = obj
        print(level.metaInfo.name)
        get = datastore_smm.DataStorePrepareGetParam()
        get.data_id = level.metaInfo.data_id
        print(getLevelCode(get.data_id))
        await process_datastore_object(obj.metaInfo)
    except Exception as e:
        logging.exception(e)


def updateLevelInDB(level, course, records, buffer_queues):
    stars = 0
    attempts = 0
    clears = 0
    for queue in buffer_queues:
        if queue["slot"] == 2:
            stars = len(queue["buffers"])

    firstClearPid = None
    firstClearTime = None
    bestClearPid = None
    bestClearTime = None
    bestClearScore = None


    if len(records) > 0:
        firstClearPid = records[0]["first_pid"]
        firstClearTime = records[0]["created_time"]["original_value"]
        bestClearPid = records[0]["best_pid"]
        bestClearTime = records[0]["updated_time"]["original_value"]
        bestClearScore = records[0]["best_score"]

    print("Storing "+level.name+" into the database...")
    sql = "INSERT INTO levels (levelid, levelcode, name, creation, ownerid, autoscroll, subautoscroll, theme, subtheme, gamestyle, objcount, subobjcount, timelimit, stars, first_clear_pid,first_clear_time,best_clear_pid,best_clear_time,best_clear_score, attempts,clears, thumb, preview, last_updated, overworld, subworld) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name = VALUES(name), thumb = VALUES(thumb), preview = VALUES(preview), last_updated = VALUES(last_updated), stars = VALUES(stars), attempts = VALUES(attempts), clears = VALUES(clears), subautoscroll = VALUES(subautoscroll), overworld = VALUES(overworld), subworld = VALUES(subworld), first_clear_pid = VALUES(first_clear_pid), first_clear_time = VALUES(first_clear_time), best_clear_pid = VALUES(best_clear_pid), best_clear_time = VALUES(best_clear_time), best_clear_score = VALUES(best_clear_score)"
    data = (level.data_id,
            getLevelCode(level.data_id),
            level.name,
            level.create_time.timestamp(),
            level.owner_id,
            course.overworld.autoscroll,
            course.subworld.autoscroll,
            course.overworld.theme,
            course.subworld.theme,
            course.overworld.gamestyle,
            course.overworld.obj_count,
            course.subworld.obj_count,
            course.overworld.timelimit,
            stars,
            firstClearPid,
            firstClearTime,
            bestClearPid,
            bestClearTime,
            bestClearScore,
            attempts,
            clears,
            course.getThumbnail(),
            course.getPreview(),
            time.time(),
            course.overworld.raw,
            course.subworld.raw
            )

    connection.cursor().execute(sql, data)
    connection.commit()
    print("Done")


def start(DEVICE_ID, SERIAL_NUMBER, SYSTEM_VERSION, REGION_ID, COUNTRY_NAME,
          LANGUAGE, USERNAME, PASSWORD, CERT):
    asyncio.run(fetchRandomLevels(DEVICE_ID, SERIAL_NUMBER, SYSTEM_VERSION, REGION_ID, COUNTRY_NAME,
                                  LANGUAGE, USERNAME, PASSWORD, CERT))

def main():
    while True:
        time.sleep(1)
        p = multiprocessing.Process(target=start,
                                    args=((int(os.getenv("DEVICE_ID")),
                                           os.getenv("SERIAL_NUMBER"),
                                           int(os.getenv("SYSTEM_VERSION"), 16),
                                           int(os.getenv("REGION_ID")),
                                           os.getenv("COUNTRY_NAME"),
                                           os.getenv("LANGUAGE"),
                                           os.getenv("USERNAME"),
                                           os.getenv("PASSWORD"),
                                           os.getenv("CERT"))
                                    ))
        p.start()
        p.join(30)
        if p.is_alive():
            print("process stuck... let's kill it...")
            p.terminate()
            p.join()

if __name__ == "__main__":
    main()
