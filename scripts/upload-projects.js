/**
 * To run this script:
 * 1. Make sure you have downloaded your `serviceAccountKey.json` and placed it in this `scripts` folder.
 * 2. Update your project and file data in a CSV file (you can use `projects-example.csv` as a template).
 * 3. Run the script from your project root, passing the CSV filename as an argument:
 *    node scripts/upload-projects.js your-data-file.csv
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// --- Configuration ---
// Path to your service account key file
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

// Get the CSV file path from command line arguments
const csvFileName = process.argv[2];
if (!csvFileName) {
  console.error('Error: Please provide the path to the CSV file as an argument.');
  console.error('Example: node scripts/upload-projects.js projects-data.csv');
  process.exit(1);
}
const csvFilePath = path.join(__dirname, csvFileName);

// --- Initialization ---
try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error('Error: Could not initialize Firebase Admin SDK.');
  console.error('Please make sure your `serviceAccountKey.json` file exists in the `/scripts` directory.');
  process.exit(1);
}

const db = admin.firestore();
console.log('Firebase Admin SDK initialized successfully.');

// A map to keep track of projects we've already created to avoid duplicate project documents.
const projectsCache = new Map();

async function processRow(row) {
  const { projectAddress, projectBNumber, fileName, fileUrl, fileSize, fileType } = row;

  if (!projectAddress || !projectBNumber || !fileName || !fileUrl) {
    console.warn('Skipping row due to missing required data:', row);
    return;
  }

  let projectId;
  const projectCacheKey = `${projectAddress}-${projectBNumber}`.toLowerCase();

  // 1. Check if we have already created this project in this run.
  if (projectsCache.has(projectCacheKey)) {
    projectId = projectsCache.get(projectCacheKey);
  } else {
    // 2. If not, check Firestore to see if a project with this address already exists.
    const projectsRef = db.collection('projects');
    const q = projectsRef.where('address', '==', projectAddress);
    const querySnapshot = await q.get();

    if (!querySnapshot.empty) {
      // Project exists, use its ID.
      const existingDoc = querySnapshot.docs[0];
      projectId = existingDoc.id;
      console.log(`Found existing project: '${projectAddress}' (ID: ${projectId})`);
    } else {
      // 3. Project doesn't exist, create it.
      const newProjectRef = await db.collection('projects').add({
        address: projectAddress,
        bNumber: projectBNumber,
      });
      projectId = newProjectRef.id;
      console.log(`Created new project: '${projectAddress}' (ID: ${projectId})`);
    }
    // Cache the projectId for this run to speed up subsequent rows for the same project.
    projectsCache.set(projectCacheKey, projectId);
  }

  // 4. Add the file to the project's 'files' subcollection.
  const filesRef = db.collection('projects').doc(projectId).collection('files');
  await filesRef.add({
    name: fileName,
    url: fileUrl,
    size: fileSize ? parseInt(fileSize, 10) : null,
    type: fileType || null,
    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`  -> Added file '${fileName}' to project '${projectAddress}'.`);
}

function uploadData() {
  if (!fs.existsSync(csvFilePath)) {
    console.error(`Error: The file '${csvFilePath}' was not found.`);
    process.exit(1);
  }
  console.log(`\nStarting upload from ${csvFilePath}...\n`);

  const promises = [];

  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      // Wrapping the async processRow call in a way that allows us to wait for all of them
      promises.push(processRow(row));
    })
    .on('end', async () => {
      try {
        await Promise.all(promises);
        console.log('\n-------------------------------------');
        console.log('CSV file successfully processed.');
        console.log('Upload complete.');
        console.log('-------------------------------------\n');
      } catch (error) {
        console.error('\nAn error occurred during the upload process:', error);
      }
    })
    .on('error', (error) => {
        console.error('An error occurred while reading the CSV file:', error);
    });
}

uploadData();
