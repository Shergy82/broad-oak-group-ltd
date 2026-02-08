import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const serveFile = onRequest(async (req, res) => {
  const path = req.query.path as string;
  const download = req.query.download === "1";

  if (!path) {
    res.status(400).send("Missing path");
    return;
  }

  const bucket = admin.storage().bucket();
  const file = bucket.file(path);

  const [exists] = await file.exists();
  if (!exists) {
    res.status(404).send("Not found");
    return;
  }

  const [meta] = await file.getMetadata();
  res.setHeader("Content-Type", meta.contentType || "application/octet-stream");

  if (download) {
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.split("/").pop()}"`
    );
  }

  file.createReadStream().pipe(res);
});
