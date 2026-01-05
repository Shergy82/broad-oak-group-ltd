import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Terminal } from "lucide-react"

export function UnconfiguredForm() {
    return (
        <Alert>
            <Terminal className="h-4 w-4" />
            <AlertTitle>Firebase Not Configured</AlertTitle>
            <AlertDescription>
                <p>
                    This application requires Firebase to be configured for authentication and database services.
                </p>
                <p className="mt-2">
                    Please create a <strong>.env.local</strong> file in the root of your project and add your Firebase project's credentials. The file should look like this:
                </p>
                <pre className="mt-2 rounded-md bg-muted p-4 text-sm font-mono">
                    {`NEXT_PUBLIC_FIREBASE_API_KEY="YOUR_API_KEY"
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="YOUR_AUTH_DOMAIN"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="YOUR_PROJECT_ID"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="YOUR_STORAGE_BUCKET"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="YOUR_MESSAGING_SENDER_ID"
NEXT_PUBLIC_FIREBASE_APP_ID="YOUR_APP_ID"`}
                </pre>
                 <p className="mt-2">
                    After creating the file, you must <strong>restart the development server</strong> for the changes to take effect.
                </p>
            </AlertDescription>
        </Alert>
    )
}
