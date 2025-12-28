Getting the Rootz file ID from a short ID

Rootz stores two different identifiers for every uploaded file: a short ID and a file ID. The short ID (for example, dtGvw) is what appears in share URLs such as https://www.rootz.so/d/dtGvw. The download API, however, uses a UUID called the file ID. You cannot pass the short ID directly to the API; you need to look up the corresponding file ID first
rootz.so
.

Why the file ID matters

The signed‑download API endpoint is:

GET https://www.rootz.so/api/files/download/{fileId}


fileId must be the file’s UUID. Calling this endpoint returns a signed Cloudflare link valid for one hour
rootz.so
. If you pass a short ID instead of the UUID, the API will return a File not found error. Therefore, before downloading, you need to determine the file ID that corresponds to your short ID.

Getting the file ID

There are two main ways to obtain the file ID:

1. Capture it when you upload

When you upload or remote‑upload a file through the API, the response includes both a shortId and an id field. For example, a successful upload response looks like this
rootz.so
:

{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",  // file ID (UUID)
    "name": "document.pdf",
    "size": 1048576,
    "url": "https://signed-url.cloudflare.com/...", // temporary signed link
    "shortId": "abc123"  // short ID
  }
}


If you store the returned data.id value when uploading, you can later pass this UUID to the download API without any further lookup.

2. Use the list endpoint to map short IDs to file IDs

If you only know the short ID and did not record the file ID at upload time, call the list API to retrieve all files in your account:

GET https://www.rootz.so/api/files/list?page=1&limit=50
Authorization: Bearer YOUR_API_KEY


This endpoint requires an API key. It returns an array of file objects. Each object includes both the id (UUID) and the short_id (share code)
rootz.so
:

{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",  // file ID
      "name": "document.pdf",
      "size": 1048576,
      "mime_type": "application/pdf",
      "path": "user-id/document.pdf",
      "short_id": "abc123",  // short ID
      "folder_id": null,
      "owner_id": "user-uuid",
      "created_at": "2025-11-16T12:00:00.000Z",
      "updated_at": "2025-11-16T12:00:00.000Z"
    },
    ...
  ],
  "pagination": { "page": 1, "limit": 50, "total": 156 }
}


You can scan this list for an entry whose short_id matches your short ID (e.g., dtGvw); its id property is the UUID you need. There is currently no documented API for converting a short ID to a UUID directly, so listing is the recommended approach when you only have the short code.

Downloading the file via API

Once you have the UUID, call the download endpoint. The response contains a signed temporary URL:

GET https://www.rootz.so/api/files/download/550e8400-e29b-41d4-a716-446655440000

Response:
{
  "success": true,
  "data": {
    "url": "https://signed-url.cloudflare.com/...",  // valid for 1 hour
    "fileName": "document.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "expiresIn": 3600,
    "downloads": 42,
    "shortId": "abc123"
  }
}


Use the data.url value to download the file content. The signed URL grants read access without additional authentication and expires in one hour
rootz.so
.

Implementing the lookup and download in an Electron app

Electron applications have access to Node.js APIs, so you can use fetch or a library like axios to call Rootz endpoints. Below is a simplified example that shows how to translate a short ID into a file ID and download the file:

const axios = require('axios');

// Replace with your Rootz API key
const API_KEY = 'YOUR_ROOTZ_API_KEY';

async function getFileIdFromShortId(shortId) {
  // Retrieve a paginated list of files (adjust page/limit if needed)
  const listResponse = await axios.get('https://www.rootz.so/api/files/list?page=1&limit=200', {
    headers: { Authorization: `Bearer ${API_KEY}` }
  });

  // Find the file whose short_id matches the short code
  const file = listResponse.data.data.find(item => item.short_id === shortId);
  if (!file) throw new Error(`File with shortId ${shortId} not found`);
  return file.id;
}

async function getDownloadUrl(fileId) {
  // Call the download API to get a temporary URL
  const downloadResponse = await axios.get(`https://www.rootz.so/api/files/download/${fileId}`);
  return downloadResponse.data.data.url;
}

async function downloadFileFromShortId(shortId) {
  const fileId = await getFileIdFromShortId(shortId);
  const signedUrl = await getDownloadUrl(fileId);
  // Now you can download the file via the signed URL (e.g., using axios or built‑in fetch)
  const fileResponse = await axios.get(signedUrl, { responseType: 'arraybuffer' });
  // `fileResponse.data` contains the file’s binary data; save or display it as needed
  return fileResponse.data;
}

// Example usage:
downloadFileFromShortId('dtGvw')
  .then(data => {
    console.log('File downloaded, size:', data.byteLength);
  })
  .catch(err => {
    console.error(err.message);
  });


In your Electron app, you can integrate this logic into a service module. The lookup function retrieves the UUID by scanning the list of your files; then the download function obtains a signed link. The final axios.get call downloads the binary content, which you can write to disk with Node’s fs module or display in the UI. If your application supports uploading, remember to store the id returned from the upload response to avoid listing files when downloading later.