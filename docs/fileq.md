# FileQ API Documentation

Source: https://fileq.net/pages/api

## Overview

FileQ is a file hosting service with a comprehensive API for managing uploads, downloads, and file operations.

## Authentication

All API requests require an API key. Include your key as a parameter: `?key=YOUR_API_KEY`

---

## Account

### Account Info

Get account information and details.

**Request:**
```bash
curl https://fileq.net/api/account/info?key=YOUR_API_KEY
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

---

### Account Stats

Retrieve account statistics and usage.

**Request:**
```bash
curl https://fileq.net/api/account/stats?key=YOUR_API_KEY
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

---

## Upload

### Step 1: Select Upload Server

Select a server which is ready to accept an upload.

**Request:**
```bash
curl https://fileq.net/api/upload/server?key=YOUR_API_KEY
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

---

### Step 2: Upload File

Upload a file to the file server selected in Step 1.

**Request:**
```bash
curl -F "sess_id=SESS_ID" -F "utype=prem" -F "file_0=@/path/to/file.bin" UPLOAD_URL
```

**Parameters:**
- `sess_id`: Session ID from Step 1
- `utype`: Upload type (`prem` for premium)
- `file_0`: The file to upload

**Response:**
```json
[
  {
    "file_code": "b578rni0e1ka",
    "file_status": "OK"
  }
]
```

**Resulting file URL:**
```
https://fileq.net/b578rni0e1ka
```

---

### Remote URL Upload

Upload files from a remote URL.

**Request:**
```bash
curl 'https://fileq.net/api/upload/url?key=YOUR_API_KEY&url=http://domain.com/1mb.bin&folder=0'
```

**Parameters:**
- `key`: Your API key
- `url`: Remote file URL to upload
- `folder`: Folder ID (0 for root)

**Response:**
```json
{
  "status": 200,
  "msg": "WORKING",
  "server_time": "2024-04-17 13:11:16"
}
```

---

### Check Remote Upload Status

Monitor the status of remote uploads.

**Request:**
```bash
curl 'https://fileq.net/api/upload/url?key=YOUR_API_KEY&file_code=b578rni0e1ka'
```

**Response:**
```json
{
  "status": "200",
  "file_code": "b578rni0e1ka"
}
```

---

## Download

### Get Direct Link

Retrieve direct download links for your own files.

**Request:**
```bash
curl https://fileq.net/api/file/direct_link?file_code=b578rni0e1ka&key=YOUR_API_KEY
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

---

## File Management

### File Info

Get information about a specific file.

**Request:**
```bash
curl https://fileq.net/api/file/info?file_code=b578rni0e1ka&key=YOUR_API_KEY
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

---

### Get Files List

Retrieve a list of all your files.

**Request:**
```bash
curl https://fileq.net/api/file/list?page=2&per_page=20&fld_id=15&public=1&created=2018-06-21%2005%3A07%3A10&name=Iron%20man&key=YOUR_API_KEY
```

**Parameters:**
- `page`: Page number
- `per_page`: Results per page
- `fld_id`: Folder ID filter
- `public`: Public visibility (1 or 0)
- `created`: Filter by creation date
- `name`: Filter by filename

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
        "link": "https://fileq.net/b578rni0e1ka/1mb.bin.html",
        "fld_id": 0,
        "uploaded": "2022-03-09 10:20:52"
      }
    ],
    "results_total": 7,
    "results": 7
  }
}
```

---

### Rename File

Change the name of a file.

**Request:**
```bash
curl https://fileq.net/api/file/rename?file_code=b578rni0e1ka&name=newname.bin&key=YOUR_API_KEY
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

---

### Clone File

Create a copy of an existing file.

**Request:**
```bash
curl https://fileq.net/api/file/clone?file_code=b578rni0e1ka&key=YOUR_API_KEY
```

**Response:**
```json
{
  "status": 200,
  "result": {
    "url": "https://fileq.net/r9o25tsq86ru",
    "filecode": "r9o25tsq86ru"
  },
  "msg": "OK",
  "server_time": "2022-03-09 10:49:48"
}
```

---

### Set File Folder

Move files to a specific folder.

**Request:**
```bash
curl https://fileq.net/api/file/set_folder?file_code=b578rni0e1ka&fld_id=15&key=YOUR_API_KEY
```

**Parameters:**
- `file_code`: File code to move
- `fld_id`: Destination folder ID

**Response:**
```json
{
  "server_time": "2022-03-09 11:26:22",
  "msg": "OK",
  "status": 200
}
```

---

### List Deleted Files

View files that have been deleted.

**Request:**
```bash
curl https://fileq.net/api/files/deleted?key=YOUR_API_KEY
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

---

### Links Checker

Verify the status of file links (bulk check).

**Request:**
```bash
curl https://fileq.net/api/files/check -F key=YOUR_API_KEY -F url_0=https://fileq.net/gkths9m7msft/file.mp4 -F url_1=https://fileq.net/jwrkz3z49262/file2.mp4
```

**Response:**
```json
{
  "status": 200,
  "msg": "OK",
  "result": {
    "https://fileq.net/gkths9m7msft/file.mp4": {
      "file_size": 127595568,
      "found": true
    },
    "https://fileq.net/jwrkz3z49262/file2.mp4": {
      "file_size": 1065186126,
      "found": true
    }
  }
}
```

---

## Folder Management

### Folder List

Get a list of all folders and their contents.

**Request:**
```bash
curl https://fileq.net/api/folder/list?fld_id=0&key=YOUR_API_KEY
```

**Parameters:**
- `fld_id`: Folder ID (0 for root)

**Response:**
```json
{
  "status": 200,
  "msg": "OK",
  "result": {
    "files": [
      {
        "fld_id": 0,
        "link": "https://fileq.net/b578rni0e1ka",
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

---

### Create Folder

Create a new folder.

**Request:**
```bash
curl https://fileq.net/api/folder/create?parent_id=0&name=newfolder&key=YOUR_API_KEY
```

**Parameters:**
- `parent_id`: Parent folder ID (0 for root)
- `name`: New folder name

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

---

### Rename Folder

Change the name of a folder.

**Request:**
```bash
curl https://fileq.net/api/folder/rename?fld_id=15&name=newname&key=YOUR_API_KEY
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

---

## Status Codes

- `200`: Success
- Other status codes indicate errors

## Additional Resources

- [Terms of Service](https://fileq.net/pages/tos/)
- [Privacy Policy](https://fileq.net/pages/privacy_policy)
- [Link Checker](https://fileq.net/check_files/)
- [FAQ](https://fileq.net/pages/faq/)
- [Contact Us](https://fileq.net/contact/)
