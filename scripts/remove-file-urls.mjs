import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp({
  credential: applicationDefault(),
});

const db = getFirestore();

async function run() {
  const projectsSnap = await db.collection('projects').get();

  for (const project of projectsSnap.docs) {
    const filesSnap = await db
      .collection(`projects/${project.id}/files`)
      .get();

    for (const file of filesSnap.docs) {
      if (file.data().url) {
        await file.ref.update({
          url: FieldValue.delete(),
        });
        console.log(`REMOVED url → ${file.ref.path}`);
      }
    }
  }

  console.log('DONE — all url fields removed');
}

run().catch(console.error);
