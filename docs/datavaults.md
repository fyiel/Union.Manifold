# Data Vaults API Documentation

## Account

### Account Info

**Request:**
```bash
$ curl https://datavaults.co/api/account/info?key=YOUR_KEY
```

**Response:**
```json
{
  "msg": "OK",
  "result": {
    "email": "user@example.com",
    "balance": "0.04900",
    "storage_used": null,
    "premium_expire": "2022-02-18 11:16:07",
    "storage_left": "inf"
  },
  "status": 200,
  "server_time": "2021-10-22 04:51:54"
}
```

### Account Stats

**Request:**
```bash
$ curl https://datavaults.co/api/account/stats?key=YOUR_KEY
```

**Response:**
```json
{
  "msg": "OK",
  "result": [
    {
      "downloads": "0",
      "sales": "0",
      "profit_sales": "0.00000",
      "profit_refs": "0.00000",
      "profit_site": "0.00000",
      "views": "0",
      "refs": "0",
      "profit_total": "0.00000"
    }
  ],
  "status": 200,
  "server_time": "2021-10-22 04:55:33"
}
```

## Upload

### Step 1: Select a Server Ready to Accept an Upload

**Request:**
```bash
$ curl https://datavaults.co/api/upload/server?key=YOUR_KEY
```

**Response:**
```json
{
  "status": 200,
  "sess_id": "3rewps03u5ipbkm9",
  "result": "http://s1.fileserverdomain.com/cgi-bin/upload.cgi",
  "msg": "OK",
  "server_time": "2021-10-22 05:13:21"
}
```

### Step 2: Upload a File to the Selected Server

**Request:**
```bash
$ curl -F "sess_id=SESS_ID" -F "utype=prem" -F "file=@path/to/file" UPLOAD_URL
```

**Response:**
```json
[
  {
    "file_code": "b578rni0e1ka",
    "file_status": "OK"
  }
]
```

**Resulting File URL:**
```
https://datavaults.co/b578rni0e1ka
```

### Remote URL Upload

**Request:**
```bash
$ curl 'https://datavaults.co/api/upload/url?key=YOUR_KEY&url=http://domain.com/1mb.bin&folder=0'
```

**Response:**
```json
{
  "status": 200,
  "msg": "WORKING",
  "server_time": "2024-04-17 13:11:16"
}
```

**Resulting File URL (after upload completes):**
```
https://datavaults.co/b578rni0e1ka
```

### Check Remote URL Upload Status

**Request:**
```bash
$ curl 'https://datavaults.co/api/upload/url?key=YOUR_KEY&file_code=b578rni0e1ka'
```

**Response:**
```json
[
  {
    "file_code": "b578rni0e1ka"
  }
]
```

## Download

### Get Your Own File Direct Link

**Request:**
```bash
$ curl https://datavaults.co/api/file/direct_link?file_code=b578rni0e1ka&key=YOUR_KEY
```

**Response:**
```json
{
  "status": 200,
  "server_time": "2021-10-22 05:26:00",
  "result": {
    "url": "http://s1.fileserverdomain.com/cgi-bin/dl.cgi/xuf4jzopi4mcmhtdbuwuyepms65d5s7fhhmzjdrhk6z2hoeqihdyqli/1mb.bin",
    "size": 1048576
  },
  "msg": "OK"
}
```

## File Management

### File Info

**Request:**
```bash
$ curl https://datavaults.co/api/file/info?file_code=b578rni0e1ka&key=YOUR_KEY
```

**Response:**
```json
{
  "status": 200,
  "server_time": "2022-03-09 10:23:03",
  "result": [
    {
      "filecode": "b578rni0e1ka",
      "name": "1mb.bin",
      "status": 200,
      "size": 1048576,
      "uploaded": "2022-03-09 10:20:52",
      "downloads": 0
    }
  ],
  "msg": "OK"
}
```

### Get Files List

**Request:**
```bash
$ curl https://datavaults.co/api/file/list?page=2&per_page=20&fld_id=15&public=1&created=2018-06-21%2005%3A07%3A10&name=Iron%20man&key=YOUR_KEY
```

**Response:**
```json
{
  "msg": "OK",
  "result": {
    "files": [
      {
        "name": "1mb.bin",
        "file_code": "b578rni0e1ka",
        "downloads": 0,
        "thumbnail": null,
        "public": 1,
        "size": 5789,
        "link": "https://datavaults.co/b578rni0e1ka/1mb.bin.html",
        "fld_id": 0,
        "uploaded": "2022-03-09 10:20:52"
      }
    ],
    "results_total": 7,
    "results": 7
  }
}
```

### Rename File

**Request:**
```bash
$ curl https://datavaults.co/api/file/rename?file_code=b578rni0e1ka&name=newname.bin&key=YOUR_KEY
```

**Response:**
```json
{
  "status": 200,
  "result": "true",
  "msg": "OK",
  "server_time": "2022-03-09 10:46:14"
}
```

### Clone File

**Request:**
```bash
$ curl https://datavaults.co/api/file/clone?file_code=b578rni0e1ka&key=YOUR_KEY
```

**Response:**
```json
{
  "status": 200,
  "result": {
    "url": "https://datavaults.co/r9o25tsq86ru",
    "filecode": "r9o25tsq86ru"
  },
  "msg": "OK",
  "server_time": "2022-03-09 10:49:48"
}
```

### Set File(s) Folder

**Request:**
```bash
$ curl https://datavaults.co/api/file/set_folder?file_code=b578rni0e1ka&fld_id=15&key=YOUR_KEY
```

**Response:**
```json
{
  "server_time": "2022-03-09 11:26:22",
  "msg": "OK",
  "status": 200
}
```

### List Deleted Files

**Request:**
```bash
$ curl https://datavaults.co/api/files/deleted?key=YOUR_KEY
```

**Response:**
```json
{
  "status": 200,
  "msg": "OK",
  "result": [
    {
      "deleted_ago_sec": 4,
      "deleted": "2022-03-09 11:41:58",
      "file_code": "ym7e86b6sap4",
      "name": "newname.bin"
    }
  ],
  "server_time": "2022-03-09 11:42:02"
}
```

## Folder Management

### Folder List

**Request:**
```bash
$ curl https://datavaults.co/api/folder/list?fld_id=0&key=YOUR_KEY
```

**Response:**
```json
{
  "status": 200,
  "msg": "OK",
  "result": {
    "files": [
      {
        "fld_id": 0,
        "link": "https://datavaults.co/b578rni0e1ka",
        "file_code": "b578rni0e1ka",
        "uploaded": "2022-03-09 10:49:51",
        "name": "1mb.bin"
      }
    ],
    "folders": [
      {
        "fld_id": 15,
        "code": null,
        "name": "folder1"
      }
    ]
  },
  "server_time": "2022-03-09 11:31:52"
}
```

### Create Folder

**Request:**
```bash
$ curl https://datavaults.co/api/folder/create?parent_id=0&name=newfolder&key=YOUR_KEY
```

**Response:**
```json
{
  "status": 200,
  "msg": "OK",
  "result": {
    "fld_id": 52
  },
  "server_time": "2022-03-09 11:37:35"
}
```

### Rename Folder

**Request:**
```bash
$ curl https://datavaults.co/api/folder/rename?fld_id=15&name=newname&key=YOUR_KEY
```

**Response:**
```json
{
  "status": 200,
  "msg": "OK",
  "result": "true",
  "server_time": "2022-03-09 11:39:29"
}
```
