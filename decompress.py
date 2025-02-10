import ctypes
from ctypes import POINTER, c_uint8
import json
from lzma import decompress

import numpy as np
import re

lib = ctypes.CDLL('./ASH0/libash.so')
lib.ash_decompress.argtypes = [POINTER(c_uint8), ctypes.c_size_t, POINTER(ctypes.c_size_t)]
lib.ash_decompress.restype = POINTER(c_uint8)

lib.ash_free.argtypes = [POINTER(c_uint8)]
lib.ash_free.restype = None


magic = b'(?=\x41\x53\x48\x30\x00)'
class World:
    def __init__(self, data):
        self.raw = data
        self.gamestyle: str = str(data[0x6A:0x6C], encoding="utf-8")
        self.theme: int = data[0x6D]
        self.timelimit: int = int.from_bytes(data[0x70:0x72])
        self.autoscroll: int = data[0x72]
        self.obj_count: int = int.from_bytes(data[0xEC:0xF0])
        self.obj: bytes = data[0xF0:0xB19]

class Course:
    def __init__(self, data):
        self.data = ashSplit(data)
        self.overworld = World(decompress(self.data[2]))
        self.subworld = World(decompress(self.data[3]))

    def getPreview(self):
        return decompress(self.data[1])[8:]
    def getThumbnail(self):
        return decompress(self.data[4])[8:]



def ashSplit(d):
    return re.split(b'(?=' + magic + b')', d)


def decompress(data):
    data_ctypes = (ctypes.c_uint8 * len(data))(*data)

    # Prepare output size variable
    output_size = ctypes.c_size_t()

    # Call the C function (decompress)
    result_ptr = lib.ash_decompress(data_ctypes, len(data), ctypes.byref(output_size))

    # Now, result_ptr points to a buffer of size output_size.value
    # Convert the result (pointer) to a numpy array
    decompressed_data = np.ctypeslib.as_array(result_ptr, shape=(output_size.value,)).tobytes()


    # After processing, free the allocated memory
    lib.ash_free(result_ptr)

    return decompressed_data