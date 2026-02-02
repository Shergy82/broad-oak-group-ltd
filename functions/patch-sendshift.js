const fs = require("fs");

const path = "src/index.ts";
let s = fs.readFileSync(path, "utf8");

const from = `
      const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
        const subscription = subDoc.data();
        return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
          functions.logger.error(\`Error sending notification to user \${userId}:\`, error);
          if (error?.statusCode === 410 || error?.statusCode === 404) {
            functions.logger.log(\`Deleting invalid subscription for user \${userId}.\`);
            return subDoc.ref.delete();
          }
          return null;
        });
      });

      await Promise.all(sendPromises);
      functions.logger.log(\`Finished sending notifications for shift \${shiftId}.\`);
`;

const to = `
      const results = await Promise.all(
        subscriptionsSnapshot.docs.map(async (subDoc) => {
          const subscription = subDoc.data();

          try {
            await webPush.sendNotification(subscription, JSON.stringify(payload));
            functions.logger.log(\`Push sent OK for user \${userId}, subDoc=\${subDoc.id}\`);
            return { ok: true, id: subDoc.id };
          } catch (error: any) {
            const code = error?.statusCode;
            functions.logger.error(
              \`Push send FAILED for user \${userId}, subDoc=\${subDoc.id}, status=\${code}\`,
              error
            );

            if (code === 410 || code === 404) {
              functions.logger.log(\`Deleting invalid subscription for user \${userId}, subDoc=\${subDoc.id}\`);
              await subDoc.ref.delete().catch(() => {});
              return { ok: false, id: subDoc.id, deleted: true, status: code };
            }

            return { ok: false, id: subDoc.id, status: code };
          }
        })
      );

      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      functions.logger.log(\`Finished sending notifications for shift \${shiftId}. ok=\${okCount} fail=\${failCount}\`);
`;

if (!s.includes(from)) {
  console.error("❌ Patch failed: target block not found. No changes made.");
  process.exit(1);
}

s = s.replace(from, to);
fs.writeFileSync(path, s);
console.log("✅ Patch applied.");
