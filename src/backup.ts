import { exec, execSync } from "child_process";
import { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, unlink, statSync, existsSync, mkdirSync } from "fs";
import { filesize } from "filesize";
import path from "path";
import os from "os";
import { format } from "date-fns";

import { env } from "./env";

const uploadToS3 = async ({ name, path }: { name: string; path: string }) => {
  console.log("Uploading backup to S3...");

  const bucket = env.AWS_S3_BUCKET;

  const client = new S3Client({
    region: env.AWS_S3_REGION,
    endpoint: env.AWS_S3_ENDPOINT,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  await new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: name,
      Body: createReadStream(path),
    },
  }).done();

  console.log("Backup uploaded to S3...");
};

const dumpToFile = async (filePath: string, dbUrl: string) => {
  console.log("Dumping DB to file...");

  await new Promise((resolve, reject) => {
    exec(
      `pg_dump --dbname=${dbUrl} --format=tar | gzip > ${filePath}`,
      (error, stdout, stderr) => {
        if (error) {
          reject({ error: error, stderr: stderr.trimEnd() });
          return;
        }

        // check if archive is valid and contains data
        const isValidArchive =
          execSync(`gzip -cd ${filePath} | head -c1`).length == 1
            ? true
            : false;
        if (isValidArchive == false) {
          reject({
            error:
              "Backup archive file is invalid or empty; check for errors above",
          });
          return;
        }

        // not all text in stderr will be a critical error, print the error / warning
        if (stderr != "") {
          console.log({ stderr: stderr.trimEnd() });
        }

        console.log("Backup archive file is valid");
        console.log("Backup filesize:", filesize(statSync(filePath).size));

        // if stderr contains text, let the user know that it was potently just a warning message
        if (stderr != "") {
          console.log(
            `Potential warnings detected; Please ensure the backup file "${path.basename(
              filePath
            )}" contains all needed data`
          );
        }

        resolve(undefined);
      }
    );
  });

  console.log("DB dumped to file...");
};

const deleteFile = async (path: string) => {
  console.log("Deleting file...");
  await new Promise((resolve, reject) => {
    unlink(path, (err) => {
      reject({ error: err });
      return;
    });
    resolve(undefined);
  });
};

export const backup = async () => {
  const dbUrls = env.BACKUP_DATABASE_URLS.split(",");
  const serviceNames = env.SERVICE_NAMES.split(",");

  console.log(`Initiating DB backup for ${dbUrls.length} services`);
  const date = new Date();
  const dateString = format(date, "yyyyMMdd");

  for (let i = 0; i < dbUrls.length; i++) {
    const dbUrl = dbUrls[i];
    const _serviceName = serviceNames[i];
    const serviceName =
      _serviceName && _serviceName.trim() != "" ? _serviceName : i + 1;

    console.log(`Initiating DB backup for ${serviceName}`);
    const filename = `${serviceName}/${dateString}.tar.gz`;
    const filepath = path.join(os.tmpdir(), filename);
    const dir = path.dirname(filepath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await dumpToFile(filepath, dbUrl);
    await uploadToS3({ name: filename, path: filepath });
    await deleteFile(filepath);
    console.log(`DB backup for ${serviceName} complete...`);
  }

  console.log("DB backup complete...");
};
