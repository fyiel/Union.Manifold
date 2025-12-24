download
ctx := context.Background()
id := "FILE_ID"
apiKey := "YOUR API KEY IF NECESSARY"

//  Get the file information.
info, err := pixeldrain.Default.File.GetFileInfo(
	file.NewGetFileInfoParamsWithContext(ctx).WithID(id),
	client.BasicAuth("", apiKey),
)
if err != nil {
	log.Fatal(err)
}

// Open a file to store the downloaded contents.
f, err := os.OpenFile(filepath.Join("~/Downloads", info.Payload.Name), os.O_CREATE|os.O_WRONLY, 0644)
if err != nil {
	log.Fatal(err)
}
defer func() {
	if err := f.Close(); err != nil {
		log.Fatal(err)
	}
}()

// If a directory path is given, the downloaded file will be stored in the directory.
_, err = pixeldrain.Default.File.DownloadFile(
	file.NewDownloadFileParamsWithContext(ctx).WithID(id),
	client.BasicAuth("", apiKey),
	f,
)
if err != nil {
	log.Fatal(err)
}
