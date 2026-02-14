# ViKiNG FiLE API Documentation

Source: https://vikingfile.com/api

## Overview

ViKiNG FiLE is a file hosting service with a comprehensive API for managing uploads, downloads, and file operations. Supports both multipart uploads for large files and legacy single-file uploads.

## Authentication

Most API requests require a user hash parameter. For anonymous uploads, use an empty string for the `user` parameter.

---

## Upload - Multipart (Recommended for Large Files)

### Get Upload URL

Get upload URLs for multipart file upload.

**Endpoint:** `POST https://vikingfile.com/api/get-upload-url`

**Parameters:**
- `size` (required) - Size of file to upload in bytes

**Request:**
```bash
curl -X POST https://vikingfile.com/api/get-upload-url \
  -d "size=3221225472"
```

**Response:**
```json
{
  "uploadId": "ANWA...SE1M",
  "key": "rZ2h9ZqVQi",
  "partSize": 1073741824,
  "numberParts": 3,
  "urls": [
    "https://upload.vikingfile.com/rZ2h9ZqVQi?partNumber=1&uploadId=ANWA...",
    "https://upload.vikingfile.com/rZ2h9ZqVQi?partNumber=2&uploadId=ANWA...",
    "https://upload.vikingfile.com/rZ2h9ZqVQi?partNumber=3&uploadId=ANWA..."
  ]
}
```

---

### Upload Each Part File

Upload each part of the file using the URLs returned by the get-upload-url endpoint.

**Endpoint:** `PUT [url from get-upload-url response]`

**Request:**
```bash
curl -X PUT "https://upload.vikingfile.com/rZ2h9ZqVQi?partNumber=1&uploadId=ANWA..." \
  --data-binary @part1.bin
```

**Response:**
- Get the part's `ETag` from the response headers

**Note:** Repeat this step for each part returned in the URLs array.

---

### Complete Upload

Complete the multipart upload after all parts have been uploaded.

**Endpoint:** `POST https://vikingfile.com/api/complete-upload`

**Parameters:**
- `key` (required) - Key returned from get-upload-url
- `uploadId` (required) - Upload ID returned from get-upload-url
- `parts` (required) - Array of parts with PartNumber and ETag
  - Format: `parts[0][PartNumber]=1&parts[0][ETag]=51887c42e7e3ec990574e8fc546faae5`
- `name` (required) - Filename
- `user` (required) - User's hash (empty for anonymous upload)
- `path` (optional) - File path, example: `Folder/My sub folder`
- `pathPublicShare` (optional) - Path public share, example: `auLXofS1Ku7SrnzA90nOz1` from `https://vikingfile.com/public-upload/auLXofS1Ku7SrnzA90nOz1`

**Request:**
```bash
curl -X POST https://vikingfile.com/api/complete-upload \
  -d "key=rZ2h9ZqVQi" \
  -d "uploadId=ANWA...SE1M" \
  -d "parts[0][PartNumber]=1" \
  -d "parts[0][ETag]=51887c42e7e3ec990574e8fc546faae5" \
  -d "parts[1][PartNumber]=2" \
  -d "parts[1][ETag]=8a7d3c5e9f1b2a4c6d8e0f1a2b3c4d5e" \
  -d "name=example.txt" \
  -d "user=YOUR_USER_HASH"
```

**Response:**
```json
{
  "name": "example.txt",
  "size": 12345,
  "hash": "TPRSfLvcIu",
  "url": "https://vikingfile.com/f/TPRSfLvcIu"
}
```

---

## Upload - Legacy Methods

### Get Upload Server

Get the upload server URL for legacy upload methods.

**Endpoint:** `GET https://vikingfile.com/api/get-server`

**Request:**
```bash
curl https://vikingfile.com/api/get-server
```

**Response:**
```json
{
  "server": "https://upload.vikingfile.com"
}
```

---

### Upload File (Legacy)

Upload a file using the legacy single-upload method.

**Endpoint:** `POST [server from get-server response]`

**Parameters:**
- `file` (required) - File to upload
- `user` (required) - User's hash (empty for anonymous upload)
- `path` (optional) - File path, example: `Folder/My sub folder`
- `pathPublicShare` (optional) - Path public share, example: `auLXofS1Ku7SrnzA90nOz1`

**Request:**
```bash
curl -X POST https://upload.vikingfile.com \
  -F "file=@/path/to/example.txt" \
  -F "user=YOUR_USER_HASH" \
  -F "path=My Folder"
```

**Response:**
```json
{
  "name": "example.txt",
  "size": 12345,
  "hash": "TPRSfLvcIu",
  "url": "https://vikingfile.com/f/TPRSfLvcIu"
}
```

---

### Upload Remote File

Upload a file from a remote URL.

**Endpoint:** `POST [server from get-server response]`

**Parameters:**
- `link` (required) - Remote file URL
- `user` (required) - User's hash (empty for anonymous upload)
- `name` (optional) - New filename
- `path` (optional) - File path, example: `Folder/My sub folder`
- `pathPublicShare` (optional) - Path public share, example: `auLXofS1Ku7SrnzA90nOz1`

**Request:**
```bash
curl -X POST https://upload.vikingfile.com \
  -d "link=https://example.com/file.zip" \
  -d "user=YOUR_USER_HASH" \
  -d "name=myfile.zip" \
  -d "path=Downloads"
```

**Response:**
```json
{
  "name": "example.txt",
  "size": 12345,
  "hash": "TPRSfLvcIu",
  "url": "https://vikingfile.com/f/TPRSfLvcIu"
}
```

---

## File Management

### Delete File

Delete a file from your account.

**Endpoint:** `POST https://vikingfile.com/api/delete-file`

**Parameters:**
- `hash` (required) - File hash, example: `TPRSfLvcIu`
- `user` (required) - Your user's hash

**Request:**
```bash
curl -X POST https://vikingfile.com/api/delete-file \
  -d "hash=TPRSfLvcIu" \
  -d "user=YOUR_USER_HASH"
```

**Response:**
```json
{
  "error": "success"
}
```

---

### Rename File

Change the name of a file.

**Endpoint:** `POST https://vikingfile.com/api/rename-file`

**Parameters:**
- `hash` (required) - File hash, example: `TPRSfLvcIu`
- `user` (required) - Your user's hash
- `filename` (required) - New filename

**Request:**
```bash
curl -X POST https://vikingfile.com/api/rename-file \
  -d "hash=TPRSfLvcIu" \
  -d "user=YOUR_USER_HASH" \
  -d "filename=newname.txt"
```

**Response:**
```json
{
  "error": "success"
}
```

---

### Check File

Check if a file exists and get its details.

**Endpoint:** `POST https://vikingfile.com/api/check-file`

**Parameters:**
- `hash` (required) - File hash, example: `TPRSfLvcIu`
  - Can be a single hash or an array: `["TPRSfLvcIu", "anotherHash"]`
  - Maximum: 100 hashes per request

**Request (Single File):**
```bash
curl -X POST https://vikingfile.com/api/check-file \
  -d "hash=TPRSfLvcIu"
```

**Request (Multiple Files):**
```bash
curl -X POST https://vikingfile.com/api/check-file \
  -d "hash[]=TPRSfLvcIu" \
  -d "hash[]=anotherHash"
```

**Response:**
```json
{
  "exist": true,
  "name": "example.txt",
  "size": 12345
}
```

---

### List Files

Get a list of your files with pagination.

**Endpoint:** `POST https://vikingfile.com/api/list-files`

**Parameters:**
- `user` (required) - Your user's hash
- `page` (required) - Current page number
- `path` (optional) - File path filter, example: `Folder/My sub folder`

**Request:**
```bash
curl -X POST https://vikingfile.com/api/list-files \
  -d "user=YOUR_USER_HASH" \
  -d "page=1" \
  -d "path=My Folder"
```

**Response:**
```json
{
  "currentPage": 1,
  "maxPages": 4,
  "files": [
    {
      "hash": "TPRSfLvcIu",
      "name": "file.rar",
      "size": 10000000,
      "downloads": 0,
      "created": "2025-12-25 10:01"
    },
    {
      "hash": "TPRSfLvcIv",
      "name": "file.png",
      "size": 15000000,
      "downloads": 10,
      "created": "2025-12-26 15:05"
    },
    {
      "hash": "TPRSfLvcIw",
      "name": "file.zip",
      "size": 19000000,
      "downloads": 5,
      "created": "2025-12-27 18:39"
    }
  ]
}
```

---

## Upload Flow Examples

### Example 1: Multipart Upload (Large Files)

```bash
# Step 1: Get upload URLs
RESPONSE=$(curl -X POST https://vikingfile.com/api/get-upload-url -d "size=3221225472")
UPLOAD_ID=$(echo $RESPONSE | jq -r '.uploadId')
KEY=$(echo $RESPONSE | jq -r '.key')
URL1=$(echo $RESPONSE | jq -r '.urls[0]')
URL2=$(echo $RESPONSE | jq -r '.urls[1]')
URL3=$(echo $RESPONSE | jq -r '.urls[2]')

# Step 2: Upload each part and capture ETags
ETAG1=$(curl -X PUT "$URL1" --data-binary @part1.bin -I | grep -i etag | cut -d' ' -f2)
ETAG2=$(curl -X PUT "$URL2" --data-binary @part2.bin -I | grep -i etag | cut -d' ' -f2)
ETAG3=$(curl -X PUT "$URL3" --data-binary @part3.bin -I | grep -i etag | cut -d' ' -f2)

# Step 3: Complete the upload
curl -X POST https://vikingfile.com/api/complete-upload \
  -d "key=$KEY" \
  -d "uploadId=$UPLOAD_ID" \
  -d "parts[0][PartNumber]=1" \
  -d "parts[0][ETag]=$ETAG1" \
  -d "parts[1][PartNumber]=2" \
  -d "parts[1][ETag]=$ETAG2" \
  -d "parts[2][PartNumber]=3" \
  -d "parts[2][ETag]=$ETAG3" \
  -d "name=largefile.bin" \
  -d "user=YOUR_USER_HASH"
```

### Example 2: Legacy Upload (Small Files)

```bash
# Step 1: Get upload server
SERVER=$(curl https://vikingfile.com/api/get-server | jq -r '.server')

# Step 2: Upload file
curl -X POST "$SERVER" \
  -F "file=@myfile.txt" \
  -F "user=YOUR_USER_HASH"
```

### Example 3: Remote File Upload

```bash
# Step 1: Get upload server
SERVER=$(curl https://vikingfile.com/api/get-server | jq -r '.server')

# Step 2: Upload from URL
curl -X POST "$SERVER" \
  -d "link=https://example.com/video.mp4" \
  -d "user=YOUR_USER_HASH" \
  -d "name=myvideo.mp4"
```

---

## Notes

- **Multipart Upload**: Recommended for files larger than 100MB. The API automatically splits large files into parts of approximately 1GB each.
- **Anonymous Upload**: Use an empty string for the `user` parameter to upload anonymously.
- **File Paths**: Use forward slashes (/) for nested folder structures: `Folder/Subfolder/Another`
- **Public Share**: When uploading to a public share folder, use the share hash from the public upload URL.
- **Batch Check**: The check-file endpoint supports checking up to 100 files in a single request.

## Additional Resources

- [ViKiNG FiLE Website](https://vikingfile.com)
- [My Account](https://vikingfile.com/my-account)
- [Premium Plans](https://vikingfile.com/premium)
