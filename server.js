import express from "express";
import mariadb from "mariadb";
import crc_32 from "crc-32";
import git from "git-rev-sync";
import Zip from "node-zip";
import {rateLimit} from 'express-rate-limit'

let {
    SMMDB_DBUSER = "smmdb",
    SMMDB_DBPASSWORD,
    SMMDB_DBIP,
    SMMDB_DBPORT = 3306,
    SMMDB_DBNAME = "smmdb",
} = process.env;
SMMDB_DBPORT = parseInt(SMMDB_DBPORT)


// Only checking one env variable
if (typeof SMMDB_DBIP !== undefined && SMMDB_DBIP !== null) {
} else {
    console.error("No environment variables defined!")
    process.exit(1);
}


const sanitize = (input) => {
    // Basic sanitization: remove unsafe characters
    return input.replace(/[^a-z0-9_\-\. ]/gi, '').trim();
};


const app = express();
app.set('trust proxy', 1 /* number of proxies between user and server */)
const downloadLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: "Please do not download too many files at once! Limited to 15 files per 5 minutes",
    validate: {xForwardedForHeader: true}
})
const courseRequestLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 5000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: "Please do not spam the API :<",
    validate: {xForwardedForHeader: true}
})
const courseThumbRequestLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 5000 * 3,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: "Please do not spam the API :<",
    validate: {xForwardedForHeader: true}
})

const pool = mariadb.createPool({
    host: SMMDB_DBIP,
    user: SMMDB_DBUSER,
    password: SMMDB_DBPASSWORD,
    port: SMMDB_DBPORT,
    database: SMMDB_DBNAME,
    connectionLimit: 15
});
BigInt.prototype['toJSON'] = function () {
    return parseInt(this.toString());
};

//py.call(pymodule, "main", ...argsWiiU);

function patchImages(rowIn) {
    if (rowIn.thumb !== undefined)
        rowIn.thumb = "data:image/jpeg;base64," + rowIn.thumb.toString('base64')
    if (rowIn.preview !== undefined)
        rowIn.preview = "data:image/jpeg;base64," + rowIn.preview.toString('base64')
}

app.set('view engine', 'ejs');

app.get("/api/course/search/:offset", courseRequestLimit, (req, res) => {
    const {offset} = req.params;
    const {
        query,
        uploadmin,
        uploadmax,
        ownername,
        ownerpid,
        pnid,
        game,
        autoscroll,
        minstars,
        maxstars,
        minobj,
        maxobj,
        hasSubworld,
        sort,
        hasFirstClear,
        limit
    } = req.query;
    let sorting = "";
    switch (sort) {
        case "star-desc":
            sorting = "ORDER BY `l`.`stars` DESC";
            break;
        case "star-asc":
            sorting = "ORDER BY `l`.`stars` ASC";
            break;
        case "obj-desc":
            sorting = "ORDER BY `l`.`objcount` DESC";
            break;
        case "obj-asc":
            sorting = "ORDER BY `l`.`objcount` ASC";
            break;
        case "subobj-desc":
            sorting = "ORDER BY `l`.`subobjcount` DESC";
            break;
        case "subobj-asc":
            sorting = "ORDER BY `l`.`subobjcount` ASC";
            break;
        case "upload-desc":
            sorting = "ORDER BY `l`.`creation` DESC";
            break;
        case "upload-asc":
            sorting = "ORDER BY `l`.`creation` ASC";
            break;
        default:
            sorting = "ORDER BY RAND()";
            break;
    }

    let where = ""
    let vars = []
    if (query) {
        if (where !== "") where += " AND "
        where += "l.`name` LIKE ?"
        vars.push("%" + query + "%")
    }
    if (ownername) {
        if (where !== "") where += " AND "
        where += "u.`name` LIKE ?"
        vars.push("%" + ownername + "%")
    }
    if (pnid) {
        if (where !== "") where += " AND "
        where += "u.`pnid` LIKE ?"
        vars.push("%" + pnid + "%")
    }
    if (ownerpid) {
        if (where !== "") where += " AND "
        where += "l.`ownerid` = ?"
        vars.push(ownerpid)
    }
    if (uploadmin) {
        if (where !== "") where += " AND "
        where += "l.`creation` >= ?"
        vars.push(new Date(uploadmin).getTime() / 1000)
    }
    if (uploadmax) {
        if (where !== "") where += " AND "
        where += "l.`creation` <= ?"
        vars.push(new Date(uploadmax).getTime() / 1000)
    }
    if (minstars) {
        if (where !== "") where += " AND "
        where += "l.`stars` >= ?"
        vars.push(minstars)
    }
    if (maxstars) {
        if (where !== "") where += " AND "
        where += "l.`stars` <= ?"
        vars.push(maxstars)
    }
    if (minobj) {
        if (where !== "") where += " AND "
        where += "l.`objcount` >= ?"
        vars.push(minobj)
    }
    if (maxobj) {
        if (where !== "") where += " AND "
        where += "l.`objcount` <= ?"
        vars.push(maxobj)
    }
    if (hasSubworld && hasSubworld !== "ignore") {
        if (where !== "") where += " AND "
        if (hasSubworld === "true")
            where += "l.`subobjcount` > 0"
        if (hasSubworld === "false")
            where += "l.`subobjcount` = 0"
    }
    if (game) {
        let games = game.split(",")
        if (games.length > 0) {
            const placeholders = games.map(() => '?').join(',');
            if (where !== "") where += " AND "
            where += `(l.\`gamestyle\`IN (${placeholders}))`
            vars.push(...games)
        }
    }
    if (autoscroll) {
        let autoscrolls = autoscroll.split(",")
        if (autoscrolls.length > 0) {
            const placeholders = autoscrolls.map(() => '?').join(',');
            if (where !== "") where += " AND "
            where += `(l.\`autoscroll\`IN (${placeholders}))`
            vars.push(...autoscrolls)
        }
    }

    if (hasFirstClear && hasFirstClear !== "ignore") {
        if (where !== "") where += " AND "
        if (hasFirstClear === "true")
            where += "l.`first_clear_pid` IS NOT NULL"
        if (hasFirstClear === "false")
            where += "l.`first_clear_pid` IS NULL"
    }

    let lim = 25
    if (limit) {
        lim = parseInt(limit)
    }

    console.log(vars)
    if (where !== "") where = "WHERE " + where;

    pool.getConnection()
        .then(conn => {
            let query = "SELECT l.`levelid`, l.`levelcode`, l.`name`, l.`creation`, l.`ownerid`, " +
                "l.`autoscroll`, l.`theme`, l.`subtheme`, l.`gamestyle`, l.`objcount`, " +
                "l.`subobjcount`, l.`timelimit`, l.`stars`, l.`attempts`, " +
                "l.`clears`, l.`last_updated`, " +
                "u.`pnid`, u.`name` AS `owner_name`, " +
                "    fc.`pid` AS `first_clear_pid`, \n" +
                "    fc.`pnid` AS `first_clear_pnid`, \n" +
                "    fc.`name` AS `first_clear_name`, \n" +
                "    bc.`pid` AS `best_clear_pid`, \n" +
                "    bc.`pnid` AS `best_clear_pnid`, \n" +
                "    bc.`name` AS `best_clear_name`\n" +
                "FROM `levels` l " +
                "JOIN `users` u ON l.`ownerid` = u.`pid` " +
                "LEFT JOIN `users` fc ON l.`first_clear_pid` = fc.`pid`\n" +
                "LEFT JOIN `users` bc ON l.`best_clear_pid` = bc.`pid`\n" +
                where + " " +
                sorting + " " +
                "LIMIT " + lim + " OFFSET ? ";
            console.log(query)
            conn.query(query, [...vars, parseInt(offset)]).then((rows) => {
                res.status(200).end(JSON.stringify(rows));
                conn.end();
            }).catch(err => {
                console.log(err);
                conn.end();
                return res.status(500).end("request error");
            })

        }).catch(err => {
        console.log(err);
        
        return res.status(500).end("database down");
    });
})
app.get("/api/course/:pid", courseRequestLimit, (req, res) => {
    const {pid} = req.params;
    pool.getConnection()
        .then(conn => {
            conn.query("SELECT `levelid`, `levelcode`, l.`name`, `creation`, `ownerid`, `autoscroll`, `theme`, `subtheme`, `gamestyle`, `objcount`, `subobjcount`, `timelimit`, `stars`, `first_clear_time`,`best_clear_time`,`best_clear_score`," +
                " `attempts`, `clears`, `thumb`, `preview`, `last_updated`," +

                "u.`pnid`, u.`name` AS `owner_name`, " +
                "    fc.`pid` AS `first_clear_pid`, \n" +
                "    fc.`pnid` AS `first_clear_pnid`, \n" +
                "    fc.`name` AS `first_clear_name`, \n" +
                "    bc.`pid` AS `best_clear_pid`, \n" +
                "    bc.`pnid` AS `best_clear_pnid`, \n" +
                "    bc.`name` AS `best_clear_name`\n" +
                " FROM `levels` l " +
                "JOIN `users` u ON l.`ownerid` = u.`pid` " +
                "LEFT JOIN `users` fc ON l.`first_clear_pid` = fc.`pid`\n" +
                "LEFT JOIN `users` bc ON l.`best_clear_pid` = bc.`pid`\n" +
                " WHERE `levelid` = ?", pid)
                .then((rows) => {
                    let row = rows[0]
                    console.log(row)
                    patchImages(row)
                    res.status(200).end(JSON.stringify(row));
                    conn.end();
                }).catch(err => {
                console.log(err);
                conn.end();
                return res.status(500).end("request error");
            })
        }).catch(err => {
        
        return res.status(500).end("database down");
    });
});

app.get("/api/stats", (req, res) => {
    pool.getConnection()
        .then(conn => {
            conn.query("SELECT (SELECT COUNT(`levelid`) FROM `levels`) AS levelcount,  (SELECT COUNT(`pid`) FROM `users`) AS usercount;")
                .then((rows) => {
                    let row = rows[0]
                    res.status(200).end(JSON.stringify(row));
                    conn.end();
                }).catch(err => {
                console.log(err);
                conn.end();
                return res.status(500).end("request error");
            })
        }).catch(err => {
        
        return res.status(500).end("database down");
    });
});
app.get("/api/curcommit", (req, res) => {
    res.send({hash: git.short("."), remote: git.remoteUrl(".")})
});


app.get("/course/random", courseRequestLimit, (req, res) => {
    pool.getConnection()
        .then(conn => {
            conn.query("SELECT levelid FROM levels ORDER BY RAND() LIMIT 1;")
                .then((rows) => {
                    console.log("Selecting course " + rows[0].levelid)
                    res.status(301).set("Cache-Control", "no-store").location("/course/" + rows[0].levelid).end();
                    conn.end();
                }).catch(err => {
                console.log(err);
                conn.end();
                return res.status(500).end("request error");
            })

        }).catch(err => {
        
        return res.status(500).end("database down");
    });
})

app.get('/course/search', function (req, res) {
    res.render('pages/search');
})
app.use(express.urlencoded({extended: true}))
app.post('/course/search', function (req, res) {
    console.log(req.body)
    res.render('pages/searchresults', req.body);
    res.status(200).end(JSON.stringify());
})
app.get("/course/:pid", courseRequestLimit, (req, res) => {
    let {pid} = req.params;
    if (pid.match(/(?:[\da-fA-F]{4}-){3}[\da-fA-F]{4}/)) {
        const cleanedHex = pid.replace(/^[\da-fA-F]{4}-|-/g, "");

        // Convert the resulting cleaned hex string to a decimal number
        pid = parseInt(cleanedHex, 16);

    }
    pool.getConnection()
        .then(conn => {
            conn.query(
                "SELECT \n" +
                "    l.`levelid`, \n" +
                "    l.`levelcode`, \n" +
                "    l.`name`, \n" +
                "    l.`creation`, \n" +
                "    l.`ownerid`, \n" +
                "    l.`autoscroll`,\n" +
                "    l.`subautoscroll`, \n" +
                "    l.`theme`, \n" +
                "    l.`subtheme`, \n" +
                "    l.`gamestyle`, \n" +
                "    l.`objcount`, \n" +
                "    l.`subobjcount`, \n" +
                "    l.`timelimit`, \n" +
                "    l.`stars`, \n" +
                "    l.`attempts`, \n" +
                "    l.`clears`, \n" +
                "    l.`thumb`, \n" +
                "    l.`preview`, \n" +
                "    l.`last_updated`, \n" +
                "    u.`pnid`, \n" +
                "    u.`name` AS `owner_name`, \n" +
                "    fc.`pid` AS `first_clear_pid`, \n" +
                "    fc.`pnid` AS `first_clear_pnid`, \n" +
                "    fc.`name` AS `first_clear_name`, \n" +
                "    bc.`pid` AS `best_clear_pid`, \n" +
                "    bc.`pnid` AS `best_clear_pnid`, \n" +
                "    bc.`name` AS `best_clear_name`,\n" +
                "    l.`best_clear_score`\n" +
                "FROM `levels` l\n" +
                "JOIN `users` u ON l.`ownerid` = u.`pid`\n" +
                "LEFT JOIN `users` fc ON l.`first_clear_pid` = fc.`pid`\n" +
                "LEFT JOIN `users` bc ON l.`best_clear_pid` = bc.`pid`\n" +
                "WHERE l.`levelid` = ?",
                [pid]
            )
                .then((rows) => {
                    let row = rows[0]
                    if (row === undefined) {
                        res.status(404).render("pages/course_404");
                        return;
                    }
                    console.log(row)
                    patchImages(row)
                    const theme = {
                        0: "Overworld",
                        1: "Underground",
                        2: "Castle",
                        3: "Airship",
                        4: "Underwater",
                        5: "Ghost House",
                    };
                    const gamestyle = {
                        "M1": "Super Mario Bros.",
                        "M3": "Super Mario Bros. 3",
                        "MW": "Super Mario World",
                        "WU": "New Super Mario Bros. U",
                    };
                    const autoscroll = {
                        0: "Off",
                        1: "Slow",
                        2: "Medium",
                        3: "Fast",
                    };
                    res.render('pages/course', {
                        levelname: row.name,
                        stars: row.stars,
                        creation: row.creation,
                        owner_id: row.ownerid,
                        thumbnail: row.thumb,
                        levelid: row.levelcode,
                        pid: row.levelid,
                        preview: row.preview,
                        owner_pnid: row.pnid,
                        owner_name: row.owner_name,
                        first_clear_pid: row.first_clear_pid,
                        first_clear_name: row.first_clear_name,
                        first_clear_pnid: row.first_clear_pnid,
                        best_clear_pid: row.best_clear_pid,
                        best_clear_pnid: row.best_clear_pnid,
                        best_clear_name: row.best_clear_name,
                        best_clear_score: row.best_clear_score,
                        last_updated: row.last_updated,
                        timelimit: row.timelimit,
                        gamestyle: row.gamestyle,
                        theme: row.theme,
                        objcount: row.objcount,
                        subobjcount: row.subobjcount,
                        subtheme: row.subtheme,
                        autoscroll: row.autoscroll,
                        subautoscroll: row.subautoscroll,
                        gamestyle_text: gamestyle[row.gamestyle],
                        theme_text: theme[row.theme],
                        subtheme_text: theme[row.subtheme],
                        autoscroll_text: autoscroll[row.autoscroll] ?? "Value out of Bounds (" + row.autoscroll + ")",
                        subautoscroll_text: autoscroll[row.subautoscroll] ?? "Value out of Bounds (" + row.subautoscroll + ")",
                    });
                    conn.end();
                }).catch(err => {
                console.log(err);
                conn.end();
                return res.status(500).end("request error");
            })
        }).catch(err => {
        
        return res.status(500).end("database down");
    });
})
app.get("/course/:pid/thumb", courseThumbRequestLimit, (req, res) => {
    const {pid} = req.params;
    pool.getConnection()
        .then(conn => {
            conn.query(
                "SELECT `thumb` FROM `levels` WHERE `levelid` = ?",
                [pid]
            )
                .then((rows) => {
                    let row = rows[0]
                    if (row === undefined) {
                        res.status(404);
                        return;
                    }
                    res.set("Content-Type", "image/jpeg");
                    res.send(row.thumb)
                    conn.end();
                }).catch(err => {
                console.log(err);
                conn.end();
                return res.status(500).end("request error");
            })
        }).catch(err => {
        return res.status(500).end("database down");
    });
})
app.get("/course/:pid/download", downloadLimit, (req, res) => {
    const {pid} = req.params;
    pool.getConnection()
        .then(conn => {
            conn.query(
                "SELECT `overworld`, `subworld`, `thumb`, `preview`, `ownerid`, `name` FROM `levels` WHERE `levelid` = ?",
                [pid]
            )
                .then((rows) => {
                    let row = rows[0]
                    if (row === undefined) {
                        res.status(404).render("pages/course_404");
                        return;
                    }
                    let zip = new Zip;
                    if (row.overworld) {

                        zip.file("course_data.cdt", row.overworld)
                        zip.file("course_data_sub.cdt", row.subworld)

                        function trimTrailingZeros(buffer) {
                            let end = buffer.length;
                            while (end > 0 && buffer[end - 1] === 0x00) {
                                end--;
                            }
                            return buffer.slice(0, end);
                        }

                        function createFileContent(data) {
                            if (!data) {
                                throw new Error('Invalid data passed to createFileContent');
                            }

                            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

                            // Only for length calculation (excluding trailing 0x00 bytes)
                            const trimmedForLength = trimTrailingZeros(buffer);

                            const length = trimmedForLength.length;

                            // Prepare the length buffer (4 bytes big endian)
                            const lengthBuffer = Buffer.alloc(4);
                            lengthBuffer.writeUInt32BE(length, 0);

                            // Combine length + full (untrimmed) data
                            const lengthAndData = Buffer.concat([lengthBuffer, buffer]);

                            // Calculate CRC32 over length + untrimmed data
                            const crc = crc_32.buf(lengthAndData);

                            // Prepare the CRC32 buffer (4 bytes big endian)
                            const crcBuffer = Buffer.alloc(4);
                            crcBuffer.writeUInt32BE(crc >>> 0, 0);

                            // Final buffer: CRC + length + untrimmed data
                            return Buffer.concat([crcBuffer, lengthAndData]);
                        }

// Add files to zip
                        zip.file("thumbnail0.tnl", createFileContent(row.preview));
                        zip.file("thumbnail1.tnl", createFileContent(row.thumb));


                        res.set("Content-Type", "application/zip")
                        const name = sanitize(row.name);
                        const filename = `[${pid}] ${name}.zip`;
                        res.set('Content-Disposition', `attachment; filename="${filename}"`);
                        var options = {base64: false, type: "nodebuffer", compression: 'DEFLATE'};
                        res.send(zip.generate(options))
                    } else {
                        res.status(404).end("Whole level files not indexed!")
                    }
                    conn.end();
                }).catch(err => {
                console.log(err);
                conn.end();
                return res.status(500).end("request error");
            })
        }).catch(err => {
        
        return res.status(500).end("database down");
    });
})
app.get("/course/:pid/preview", courseThumbRequestLimit, (req, res) => {
    const {pid} = req.params;
    pool.getConnection()
        .then(conn => {
            conn.query(
                "SELECT `preview` FROM `levels` WHERE `levelid` = ?",
                [pid]
            )
                .then((rows) => {
                    let row = rows[0]
                    if (row === undefined) {
                        res.status(404);
                        return;
                    }
                    res.set("Content-Type", "image/jpeg");
                    res.send(row.preview)
                    conn.end();
                }).catch(err => {
                console.log(err);
                conn.end();
                return res.status(500).end("request error");
            })
        }).catch(err => {
        
        return res.status(500).end("database down");
    });
})

app.get('/', function (req, res) {
    res.render('pages/index');
})
app.get('/top', function (req, res) {
    res.render('pages/top');
})
app.get('/new', function (req, res) {
    res.render('pages/new');
})
app.get('/100mario', function (req, res) {
    res.render('pages/100mario');
})


app.get('/user/:pid', courseRequestLimit, function (req, res) {
    const {pid} = req.params;
    pool.getConnection()
        .then(conn => {
            conn.query(
                "SELECT `pid`, `name`, `pnid` FROM `users` WHERE `pid` = ?",
                [pid]
            )
                .then((rows) => {
                    let row = rows[0]
                    if (row === undefined) {
                        res.status(404).render("pages/user_404");
                        return;
                    }
                    res.render('pages/user', {
                        pid: row.pid,
                        name: row.name,
                        pnid: row.pnid
                    });
                    conn.end()
                }).catch(err => {
                console.log(err);
                conn.end();
                return res.status(500).end("request error");
            })
        }).catch(err => {
        
        return res.status(500).end("database down");
    });
})
app.get('/partial/course', (req, res) => {
    res.render('partials/course_card', req.query);
});
app.get('/partial/user', (req, res) => {
    res.render('partials/user_profile', req.query);
});

app.use(express.static("html/"));
app.listen(process.env.PORT ?? 8764);
app.use(function (req, res, next) {
    res.status(404);

    // respond with html page
    if (req.accepts('html')) {
        res.render('pages/generic_404', {url: req.url});
        return;
    }

    // respond with json
    if (req.accepts('json')) {
        res.json({error: 'Not found'});
        return;
    }

    res.type('txt').send('Not found');
});
