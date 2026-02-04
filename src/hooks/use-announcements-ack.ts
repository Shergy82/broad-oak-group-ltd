import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export async function acknowledgeAnnouncement(
  announcementId: string,
  user: any,
  name: string
) {
  const id = \`\${announcementId}_\${user.uid}\`;

  await setDoc(doc(db, "announcementAcknowledgements", id), {
    announcementId,
    userId: user.uid,
    name,
    acknowledgedAt: serverTimestamp(),
  });
}

export async function hasAcknowledged(
  announcementId: string,
  user: any
) {
  const id = \`\${announcementId}_\${user.uid}\`;

  return (await getDoc(doc(db, "announcementAcknowledgements", id))).exists();
}
