# Pixeldrain API Documentation

Source: https://pixeldrain.com/api

## Overview

Pixeldrain is a file transfer service where you can upload any file and get a shareable link instantly. Supports previews for images, videos, audio, PDFs and much more.

## Authentication

All methods which create, modify or delete a resource require an API key. API keys can be obtained from your user account's [API keys page](https://pixeldrain.com/user/api_keys).

To use the API key you need to enter it in the password field of [HTTP Basic Access Authentication](https://en.wikipedia.org/wiki/Basic_access_authentication). The username field does not matter, it can be empty or anything else.

**Base URL:** `https://pixeldrain.com/api`

All paths below are relative to this base URL.

### Authentication Example (JavaScript)

```javascript
const resp = await fetch(
    "https://pixeldrain.com/api/user/files",
    {
        headers: {
            "Authorization": "Basic " + btoa(":" + api_key),
            // The btoa function encodes the key to Base64
        },
    }
)
if(resp.status >= 400) {
    throw new Error(await resp.json())
}
result = await resp.json()
```

### Authentication Example (curl)

```bash
curl -T "file_name.txt" -u :YOUR_API_KEY https://pixeldrain.com/api/file/
```

Replace `YOUR_API_KEY` with your actual API key from the [API keys page](https://pixeldrain.com/user/api_keys).

---

## API Tips

### HREF Fields

Some JSON responses include fields which end in "_href" (Hypertext Reference). These point to different places in the API, which you can retrieve with a GET request. The path is to be appended to the API URL, so `/file/someid/thumbnail` becomes `/api/file/someid/thumbnail`.

### Form Value Order

Put files at the end of every file upload form. By doing this the pixeldrain server can respond to malformed requests before the file upload finishes, saving time and bandwidth. Make sure your HTTP client supports premature responses. If the server responds before your request is finished it will always indicate an error and you may abort the connection.

---

## File Methods

### Upload File (POST - Multipart)

**Note:** The PUT API is recommended over POST. It's easier to use and the multipart encoding of POST can cause performance issues.

**Endpoint:** `POST /file`

**Parameters:**

| Param | Type | Required | Maximum Size | Default | Description |
|-------|------|----------|--------------|---------|-------------|
| name | string | false | 255 characters | multipart file name | Name of the file to upload |
| file | multipart file | true | Depends on subscription | none | File to upload |

**Request:**
```bash
curl -X POST https://pixeldrain.com/api/file \
  -u :YOUR_API_KEY \
  -F "file=@example.txt" \
  -F "name=example.txt"
```

**Response (200 OK):**
```json
{
  "success": true,
  "id": "abc123"
}
```

**Error Responses:**

- **422 Unprocessable Entity:** File does not exist or is empty
- **413 Payload Too Large:** File is too large or name is too long (max 255 characters)
- **500 Internal Server Error:** Server error or disk space issue

---

### Upload File (PUT - Recommended)

**Endpoint:** `PUT /file/{name}`

**Parameters:**

| Param | Type | Required | Location | Maximum Size | Description |
|-------|------|----------|----------|--------------|-------------|
| name | string | true | URL | 255 characters | Name of the file to upload |
| file | file | true | request body | Depends on subscription | File to upload |

**Request:**
```bash
curl -X PUT https://pixeldrain.com/api/file/example.txt \
  -u :YOUR_API_KEY \
  --data-binary @example.txt
```

**Response (201 Created):**
```json
{
  "id": "abc123"
}
```

**Error Responses:**

- **422 Unprocessable Entity:** File does not exist or is empty
- **413 Payload Too Large:** File is too large or name is too long (max 255 characters)
- **500 Internal Server Error:** Server error or disk space issue

---

### Get File

**Endpoint:** `GET /file/{id}`

**Description:**

Returns the full file associated with the ID. Supports byte range requests.

**URL Parameters:**
- `?download` - Sends attachment header instead of inline rendering (triggers "Save File" dialog)

**Warning:** Files can be rate limited if they have three times more downloads than views. Rate limited files require captcha verification (except for file owners). Hotlinking is only allowed for Pro accounts.

**Parameters:**

| Param | Required | Location | Description |
|-------|----------|----------|-------------|
| id | true | URL | ID of the file to request |
| download | false | URL | Sends attachment header instead of inline |

**Request:**
```bash
curl https://pixeldrain.com/api/file/abc123
curl https://pixeldrain.com/api/file/abc123?download
```

**Response (200 OK):**
```
[File data]
```

**Error Responses:**

- **404 Not Found:** File not found
- **403 Forbidden:** Rate limited or virus detected - captcha required

---

### Get File Info

**Endpoint:** `GET /file/{id}/info`

**Description:**

Returns information about one or more files. You can provide a comma-separated list of file IDs (max 1000) to get info for multiple files.

**Parameters:**

| Param | Required | Location | Description |
|-------|----------|----------|-------------|
| id | true | URL | ID of the file (or comma-separated list) |

**Request:**
```bash
curl https://pixeldrain.com/api/file/abc123/info
curl https://pixeldrain.com/api/file/abc123,def456,ghi789/info
```

**Response (200 OK):**
```json
{
  "id": "abc123",
  "name": "screenshot.png",
  "size": 5694837,
  "views": 1234,
  "bandwidth_used": 1234567890,
  "bandwidth_used_paid": 1234567890,
  "downloads": 1234,
  "date_upload": "2020-02-04T18:34:05.706801Z",
  "date_last_view": "2020-02-04T18:34:05.706801Z",
  "mime_type": "image/png",
  "thumbnail_href": "/file/abc123/thumbnail",
  "hash_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "can_edit": true
}
```

**Response Fields:**
- `id` - File ID
- `name` - File name
- `size` - File size in bytes
- `views` - Number of unique views (counted once per IP)
- `bandwidth_used` - Total bandwidth usage
- `bandwidth_used_paid` - Premium bandwidth usage
- `downloads` - Unique downloads per IP
- `date_upload` - Upload timestamp
- `date_last_view` - Last view timestamp
- `mime_type` - File MIME type
- `thumbnail_href` - Link to thumbnail
- `hash_sha256` - SHA256 hash in hexadecimal
- `can_edit` - Whether current user can edit the file

**Error Response (404 Not Found):**
```json
{
  "success": false,
  "value": "file_not_found"
}
```

---

### Get File Thumbnail

**Endpoint:** `GET /file/{id}/thumbnail?width=x&height=x`

**Description:**

Returns a PNG thumbnail image representing the file. Default size is 128x128 px. Width and height must be multiples of 16 (allowed values: 16, 32, 48, 64, 80, 96, 112, 128). If a thumbnail cannot be generated, you'll be redirected to a mime type image.

**Parameters:**

| Param | Required | Location | Description |
|-------|----------|----------|-------------|
| id | true | URL | ID of the file |
| width | false | URL | Width of thumbnail (multiple of 16) |
| height | false | URL | Height of thumbnail (multiple of 16) |

**Request:**
```bash
curl https://pixeldrain.com/api/file/abc123/thumbnail
curl https://pixeldrain.com/api/file/abc123/thumbnail?width=64&height=64
```

**Response:**

PNG image or 301 redirect to mime type image

---

### Delete File

**Endpoint:** `DELETE /file/{id}`

**Description:**

Deletes a file. Only works when the user owns the file.

**Parameters:**

| Param | Required | Location | Description |
|-------|----------|----------|-------------|
| id | true | URL | ID of the file to delete |

**Request:**
```bash
curl -X DELETE https://pixeldrain.com/api/file/abc123 \
  -u :YOUR_API_KEY
```

**Response (200 OK):**
```json
{
  "success": true,
  "value": "file_deleted",
  "message": "The file has been deleted."
}
```

**Error Responses:**

- **404 Not Found:** File not found
- **401 Unauthorized:** Not logged in
- **403 Forbidden:** Not your file

---

## List Methods (Albums)

### Create List

**Endpoint:** `POST /list`

**Description:**

Creates a list of files that can be viewed together on the file viewer page. A list can contain at most 10,000 files.

**Request Body (JSON):**
```json
{
  "title": "My beautiful photos",
  "anonymous": false,
  "files": [
    {
      "id": "abc123",
      "description": "First photo of the week, such a beautiful valley"
    },
    {
      "id": "123abc",
      "description": "The week went by so quickly, here's a photo from the plane back"
    }
  ]
}
```

**Parameters:**
- `title` (string, optional) - List title (max 300 characters). Defaults to "Pixeldrain List"
- `anonymous` (boolean, optional) - If true, list won't be linked to user account. Defaults to false
- `files` (array, required) - Ordered array of files
  - `id` (string, required) - File ID
  - `description` (string, optional) - File description (max 3000 characters)

**Request:**
```bash
curl -X POST https://pixeldrain.com/api/list \
  -u :YOUR_API_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Photos",
    "files": [
      {"id": "abc123", "description": "Photo 1"},
      {"id": "def456", "description": "Photo 2"}
    ]
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "id": "yay137"
}
```

**Error Responses:**

- **422 Unprocessable Entity:** File not found, JSON parse failed, or empty list
- **413 Payload Too Large:** Too many files (max 10,000), title too long (max 300), or description too long (max 3000)

---

### Get List Info

**Endpoint:** `GET /list/{id}`

**Description:**

Returns information about a file list and the files in it.

**Parameters:**

| Param | Required | Location | Description |
|-------|----------|----------|-------------|
| id | true | URL | ID of the list |

**Request:**
```bash
curl https://pixeldrain.com/api/list/yay137
```

**Response (200 OK):**
```json
{
  "success": true,
  "id": "L8bhwx",
  "title": "Rust in Peace",
  "date_created": "2020-02-04T18:34:13.466276Z",
  "files": [
    {
      "detail_href": "/file/_SqVWi/info",
      "description": "",
      "success": true,
      "id": "_SqVWi",
      "name": "01 Holy Wars... The Punishment Due.mp3",
      "size": 123456,
      "date_created": "2020-02-04T18:34:13.466276Z",
      "date_last_view": "2020-02-04T18:34:13.466276Z",
      "mime_type": "audio/mp3",
      "views": 1,
      "bandwidth_used": 1234567890,
      "thumbnail_href": "/file/_SqVWi/thumbnail"
    }
  ]
}
```

**Note:** Each file includes a `detail_href` field pointing to the file's info API endpoint for more details.

**Error Response (404 Not Found):**
```json
{
  "success": false,
  "value": "list_not_found"
}
```

---

## User Methods

**Note:** All user methods require authentication.

### Get User Files

**Endpoint:** `GET /user/files`

**Description:**

Returns a list of all files uploaded by the authenticated user.

**Request:**
```bash
curl https://pixeldrain.com/api/user/files \
  -u :YOUR_API_KEY
```

**Documentation:** Visit [/api/user/files](https://pixeldrain.com/api/user/files) while logged in to see the response format.

---

### Get User Lists

**Endpoint:** `GET /user/lists`

**Description:**

Returns a list of all file lists (albums) created by the authenticated user.

**Request:**
```bash
curl https://pixeldrain.com/api/user/lists \
  -u :YOUR_API_KEY
```

**Documentation:** Visit [/api/user/lists](https://pixeldrain.com/api/user/lists) while logged in to see the response format.

---

## Complete Upload Example

```bash
#!/bin/bash

# Upload a file with PUT method (recommended)
RESPONSE=$(curl -s -X PUT https://pixeldrain.com/api/file/myfile.txt \
  -u :YOUR_API_KEY \
  --data-binary @myfile.txt)

# Extract file ID from response
FILE_ID=$(echo $RESPONSE | jq -r '.id')

echo "File uploaded successfully!"
echo "File ID: $FILE_ID"
echo "URL: https://pixeldrain.com/u/$FILE_ID"

# Get file info
curl https://pixeldrain.com/api/file/$FILE_ID/info
```

---

## Features

- **Instant Sharing:** Get shareable links immediately after upload
- **File Previews:** Supports images, videos, audio, PDFs, and more
- **Storage:** Free tier available, Pro subscriptions for larger files
- **Bandwidth Sharing:** Pro users can share bandwidth with others
- **Virus Scanner:** Automatic malware detection
- **Rate Limiting:** Protection against hotlinking and abuse
- **Thumbnails:** Automatic thumbnail generation for compatible files
- **Albums (Lists):** Group multiple files together
- **API Keys:** Multiple API keys for different applications

---

## Additional Resources

- [Get Premium](https://pixeldrain.com/home#pro)
- [Apps](https://pixeldrain.com/apps)
- [Filesystem Guide](https://pixeldrain.com/filesystem)
- [Server Status](https://pixeldrain.com/status)
- [DMCA and Abuse](https://pixeldrain.com/abuse)
- [Questions & Answers](https://pixeldrain.com/about)
- [Speedtest](https://pixeldrain.com/speedtest)

---

## Community

- [Patreon](https://www.patreon.com/pixeldrain)
- [Reddit](https://reddit.com/r/pixeldrain)
- [GitHub](https://github.com/Fornaxian)
- [Mastodon](https://mastodon.social/web/@fornax)

---

## Notes

- **File Limits:** Maximum file size depends on your subscription level
- **Character Limits:** Filenames max 255 characters, list titles max 300, descriptions max 3000
- **List Limits:** Maximum 10,000 files per list
- **Batch Operations:** File info endpoint supports up to 1,000 files at once
- **Premature Responses:** Client must support early server responses for optimal performance
- **Rate Limiting:** Files with 3x more downloads than views require captcha verification
- **Hotlinking:** Only allowed for Pro accounts
- **Virus Detection:** Malware-flagged files require captcha to download

Pixeldrain is a product by [Fornaxian Technologies](https://fornaxian.tech)
