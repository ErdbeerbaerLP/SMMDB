create or replace table users
(
    pid  bigint   not null
        primary key,
    name tinytext not null,
    pnid tinytext not null
);

create or replace table levels
(
    levelid          bigint                                  not null
        primary key,
    levelcode        tinytext                                not null,
    name             text                                    not null,
    creation         bigint                                  not null,
    ownerid          bigint                                  not null,
    autoscroll       tinyint                                 not null,
    subautoscroll    tinyint                      default -1 not null,
    theme            tinyint                                 not null,
    subtheme         tinyint                                 not null,
    gamestyle        tinytext                                not null,
    objcount         int                                     not null,
    subobjcount      int                                     not null,
    timelimit        int                                     not null,
    stars            int                          default 0  not null,
    first_clear_pid  bigint                                  null,
    first_clear_time bigint                                  null,
    best_clear_pid   bigint                                  null,
    best_clear_time  bigint                                  null,
    best_clear_score bigint                                  null,
    attempts         int                          default 0  not null,
    clears           int                          default 0  not null,
    thumb            blob /*M!100301 COMPRESSED*/ default '' not null,
    preview          blob /*M!100301 COMPRESSED*/ default '' not null,
    last_updated     bigint                                  not null,
    overworld        longblob /*M!100301 COMPRESSED*/        null,
    subworld         longblob /*M!100301 COMPRESSED*/        null,
    constraint best_clear
        foreign key (best_clear_pid) references users (pid),
    constraint first_clear
        foreign key (first_clear_pid) references users (pid),
    constraint users
        foreign key (ownerid) references users (pid)
);

