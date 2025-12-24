Retrieve a file
Get a signed download URL for a file.

Endpoint
GET https://www.rootz.so/api/files/download/[fileId]
Authentication
No authentication required. Anyone with the file ID can download the file.

Request Examples
Retrieve a signed download URL by providing the file ID. The URL expires in 1 hour.
// Get download URL and file info
const getDownloadUrl = async (fileId) => {
  const response = await fetch(`https://www.rootz.so/api/files/download/${fileId}`);
  const result = await response.json();
  
  if (result.success) {
    console.log('Download URL (expires in 1 hour):', result.data.url);
    console.log('File name:', result.data.fileName);
    console.log('File size:', result.data.size, 'bytes');
    console.log('MIME type:', result.data.mimeType);
    console.log('Total downloads:', result.data.downloads);
    return result.data;
  } else {
    throw new Error(result.error || 'Failed to get download URL');
  }
};

// Download file to browser
const downloadFileToBrowser = async (fileId) => {
  const data = await getDownloadUrl(fileId);
  
  const link = document.createElement('a');
  link.href = data.url;
  link.download = data.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  console.log('Download started:', data.fileName);
};

// Download file in Node.js
const downloadFileToNode = async (fileId, outputPath) => {
  const data = await getDownloadUrl(fileId);
  
  const response = await fetch(data.url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }
  
  const buffer = await response.arrayBuffer();
  const fs = require('fs');
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  console.log(`Saved to ${outputPath} (${data.size} bytes)`);
};

// Example usage
const fileId = '550e8400-e29b-41d4-a716-446655440000';

// In browser:
downloadFileToBrowser(fileId)
  .then(() => console.log('Download complete'))
  .catch(err => console.error('Error:', err));

// In Node.js:
downloadFileToNode(fileId, './downloaded-file.pdf')
  .then(() => console.log('File saved'))
  .catch(err => console.error('Error:', err));
  Parameters
Parameter	Type	Required	Description
fileId	String (UUID)	Yes	The unique identifier of the file
Response
Returns a signed download URL that expires in 1 hour (3600 seconds).


{
  "success": true,
  "data": {
    "url": "https://signed-url.cloudflare.com/...",
    "fileName": "document.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "expiresIn": 3600,
    "expiresAt": null,
    "downloads": 42,
    "canDelete": false,
    "shortId": "abc123"
  }
}
Error Response

{
  "success": false,
  "error": "File not found"
}
Usage Notes
The signed URL expires in 1 hour (3600 seconds)
Each request to this endpoint counts as a download
The actual file is downloaded from the signed URL, not this endpoint
Downloads are tracked for analytics purposes