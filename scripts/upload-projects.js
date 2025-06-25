/**
 * To run this script:
 * 1. Make sure you have downloaded your `serviceAccountKey.json` and placed it in this `scripts` folder.
 * 2. Place your project files in the `public/project_files` directory.
 *    - Create a subfolder for each project.
 *    - The folder name MUST be in the format: "Project Address /// Project B Number"
 *      (e.g., "123 Main Street, Anytown /// B-12345")
 *    - Place all files for that project inside its folder.
 * 3. IMPORTANT: You must DEPLOY your application for any new or changed files to be accessible.
 * 4. After deploying, run this script from your project root to sync the file list with your database:
 *    node scripts/upload-projects.js
 *
 * This script will find your local files, create project entries in Firestore if they don't exist,
 * and update the file list for each project. It does NOT upload files; it only syncs the database.
 */
const admin = require('firebase-admin');
const fs = require('fs').promises;
const path = require('path');

// --- Configuration ---
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
// The source directory is now inside the 'public' folder.
// Files here will be publicly accessible after deployment.
const projectsDirPath = path.join(process.cwd(), 'public', 'project_files');
const FOLDER_SEPARATOR = '///';

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

const projectsCache = new Map();

async function findOrCreateProject(address, bNumber) {
    const projectCacheKey = `${address}-${bNumber}`.toLowerCase();
    if (projectsCache.has(projectCacheKey)) {
        return projectsCache.get(projectCacheKey);
    }

    const projectsRef = db.collection('projects');
    const q = projectsRef.where('address', '==', address).where('bNumber', '==', bNumber);
    const querySnapshot = await q.get();

    let projectId;
    if (!querySnapshot.empty) {
        projectId = querySnapshot.docs[0].id;
        console.log(`Found existing project: '${address}' (ID: ${projectId})`);
        // Clear existing files for this project to ensure a clean sync
        const filesSnapshot = await db.collection('projects').doc(projectId).collection('files').get();
        if (!filesSnapshot.empty) {
            const batch = db.batch();
            filesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            console.log(`  -> Cleared ${filesSnapshot.size} old file record(s) from Firestore.`);
        }
    } else {
        const newProjectRef = await db.collection('projects').add({
            address: address,
            bNumber: bNumber,
        });
        projectId = newProjectRef.id;
        console.log(`Created new project: '${address}' (ID: ${projectId})`);
    }

    projectsCache.set(projectCacheKey, projectId);
    return projectId;
}

async function processProjectFolder(projectFolderPath) {
    const folderName = path.basename(projectFolderPath);
    const parts = folderName.split(FOLDER_SEPARATOR).map(p => p.trim());

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        console.warn(`Skipping folder with invalid name format: "${folderName}". Expected "Address /// B Number".`);
        return;
    }
    const [address, bNumber] = parts;

    try {
        const projectId = await findOrCreateProject(address, bNumber);
        const filesInDir = await fs.readdir(projectFolderPath);

        if (filesInDir.length === 0) {
            console.log(`No files found in "${folderName}", skipping.`);
            return;
        }

        for (const fileName of filesInDir) {
            const filePath = path.join(projectFolderPath, fileName);
            const stats = await fs.stat(filePath);
            if (stats.isFile() && fileName !== '.DS_Store') { // Ignore system files
                // Construct a URL-safe relative path
                const publicUrl = encodeURI(`/project_files/${folderName}/${fileName}`);

                const fileData = {
                    name: fileName,
                    url: publicUrl,
                    size: stats.size,
                    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                };

                await db.collection('projects').doc(projectId).collection('files').add(fileData);
                console.log(`  -> Synced file record '${fileName}' to Firestore.`);
            }
        }
    } catch (error) {
        console.error(`Failed to process project folder "${folderName}":`, error);
    }
}


async function startSync() {
  try {
    // Check if the source directory exists.
    try {
      await fs.access(projectsDirPath);
    } catch {
      console.log(`Source directory not found. Creating it at: ${projectsDirPath}`);
      console.log("Please add your project folders and files there, then redeploy the app before running this script again.");
      await fs.mkdir(projectsDirPath, { recursive: true });
      return; // Stop execution if the folder was just created.
    }

    const projectFolders = await fs.readdir(projectsDirPath, { withFileTypes: true });

    console.log('\n-------------------------------------');
    console.log(`Starting sync from local directory: "${path.relative(process.cwd(), projectsDirPath)}"`);
    console.log('This script syncs your local file structure to the Firestore database.');
    console.log('IMPORTANT: You must redeploy your app for any file changes to be live.');
    console.log('-------------------------------------\n');


    if (projectFolders.length === 0) {
      console.log('No project folders found in the sync directory. Please add project folders and files to continue.');
      return;
    }

    for (const dirent of projectFolders) {
      if (dirent.isDirectory()) {
        await processProjectFolder(path.join(projectsDirPath, dirent.name));
      }
    }

    console.log('\n-------------------------------------');
    console.log('Sync processing complete.');
    console.log('-------------------------------------\n');

  } catch (error) {
    console.error('An unexpected error occurred:', error);
  }
}

startSync();
