# SMMDB
Super Mario Maker Database for the Pretendo Servers. 


# SETUP
This project uses MariaDB as database backend. The commands to create the required tables are in the file `database_tables.sql` 
## Required environment variables
```
SYSTEM_VERSION - System Version in Hexadecimal
SERIAL_NUMBER - Console Serial Number
DEVICE_ID - Console Device ID
REGION_ID - Region ID
COUNTRY_NAME - Country name
LANGUAGE - Language code
CERT - Console certificate copied from network dump
USERNAME - Network ID
PASSWORD - Password Hash from Network Dump

SMMDB_DBPASSWORD - Database Password
SMMDB_DBIP - Database IP Address
```
## Optional environment variables
```
SMMDB_DBPORT - Database Port (Default: 3306)
SMMDB_DBNAME - Database-Name (Default: "smmdb")
SMMDB_DBUSER - Database Username (Default: "smmdb")
SMMDB_MAXLEVELS - Max Levels to fetch at once (Default: 20)
PORT - HTTP server port (Default: 8764)
```

## indexer.py
This script fetches mario maker levels and stores them to the database. 

### Install dependencies
```sh
pip3 install -r requirements.txt
```

### Run
Make sure the environment variables have been set, or pass them along this command
```sh
python3 indexer.py
```

## server.js
- **Requires** Node 20

This is the actual webserver accessing the database and displaying the website. Recommended to put behind a reverse proxy with HTTPS set-up.

### Install dependencies
```sh
npm install
```

### Run
```sh
npm run start
```
or, if you want to use the .env file
```sh
npm run start-dotenv
```

