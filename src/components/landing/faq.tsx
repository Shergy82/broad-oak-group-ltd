"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Image from 'next/image';
import { PlaceHolderImages } from "@/lib/placeholder-images";

const faqs = [
  {
    question: "How do I see my upcoming shifts?",
    answer: "Your main Dashboard is your central hub for viewing your schedule. At the top, you'll find tabs to filter your view:\n\n- **Today**: Shows only shifts scheduled for the current day, split into AM and PM sections.\n- **This Week**: Displays all your shifts for the current week (Monday to Sunday).\n- **Next Week / Week 3 / Week 4**: Allows you to look ahead at your schedule.\n\nShifts you have recently completed or marked as incomplete are shown in the **'Recently Completed'** section at the bottom of the page. You can dismiss these old shifts from your view by using the 'Dismiss' button.",
    imageId: "faq-shifts"
  },
  {
    question: "How do I confirm a new shift I've been assigned?",
    answer: "When an administrator assigns you one or more new shifts, a dialog box will appear automatically when you next log in or visit the app. It will list all the new assignments awaiting your confirmation. \n\nAfter reviewing the new shifts, click the **'Accept All'** button. This will change their status from 'Pending' to 'Confirmed' and add them to your main schedule.",
    imageId: "faq-confirm-shift"
  },
  {
    question: "What is the lifecycle of a shift's status?",
    answer: "A shift progresses through several statuses, each with its own button on the shift card:\n\n1.  **Pending**: A new shift you haven't accepted yet.\n2.  **Confirmed**: You have accepted the shift by clicking 'Accept Shift'.\n3.  **On Site**: When you arrive at the job site, click the 'On Site' button. This is important as it may unlock a checklist of tasks for the job.\n4.  **Complete / Incomplete**: When you finish, you must mark the shift as either 'Complete' or 'Incomplete'. If you select 'Incomplete', you will be required to write a short note explaining why the job could not be finished (e.g., 'Client not home', 'Waiting on materials'). This note is visible to administrators.",
    imageId: "faq-lifecycle"
  },
  {
    question: "How do I use the on-shift Checklist?",
    answer: "For certain jobs, a checklist of required tasks will appear on the shift card after you have marked yourself as **'On Site'**. \n\nAs you finish each item, simply check the box next to it. If a task has a camera icon, it means a photo is required for that step. Clicking the checkbox for a photo-required task will open your device's camera. The photo you take will be automatically timestamped, geotagged, and uploaded to the project's evidence folder with the correct tag.",
    imageId: "faq-checklist"
  },
  {
    question: "How do I upload general files or photos to a project?",
    answer: "Navigate to the **'Projects'** page from the main menu. Here you'll see a list of all projects. Within each project card, there is a file management section. \n\nYou can use the **'Upload File'** button to select files from your device. You can also use the optional **'Evidence Tag'** field before uploading; this is useful for manually linking photos to specific evidence requirements, such as 'front-of-property'.",
    imageId: "faq-upload"
  },
  {
    question: "What are the different Admin dashboards for? (Admin)",
    answer: "The Admin Area, accessible from the user menu, contains several specialized dashboards:\n\n- **Control Panel**: A customizable dashboard where you can add, remove, and reorder your most-used admin widgets.\n- **Team Schedule**: A real-time overview of all shifts for all users, with filtering and PDF export options.\n- **Availability**: A powerful tool to see which operatives are free, partially busy, or unavailable on any given day or date range.\n- **Mapping**: A live map showing the location of all operatives with shifts scheduled for today.\n- **Contracts, Performance, Tasks, Evidence**: Dashboards for high-level KPIs, task management, and evidence tracking.",
    imageId: "faq-admin-dash"
  },
  {
    question: "How do I use the Evidence Dashboard? (Admin)",
    answer: "This dashboard gives a visual overview of evidence collection status for all active projects, grouped by contract. The cards are color-coded:\n\n- **Red (Incomplete)**: One or more required evidence photos are missing.\n- **Orange (Ready)**: All required photos have been uploaded. You can now click 'Generate PDF' to create a consolidated evidence report for the client.\n- **Green (Generated)**: A PDF report has already been created. You can either delete the project to archive it or click 'More Evidence' to reset its status if additional photos are needed.",
    imageId: "faq-evidence"
  },
  {
    question: "How does the Excel shift import work? (Admin)",
    answer: "From the header on the Team Schedule or via your Control Panel, click 'Import Shifts'. Upload your Excel file. The system will read the sheets and allow you to select which ones to process.\n\nCrucially, always use the **'Dry Run'** option first. This simulates the import and shows you a detailed summary of what will happen: which shifts will be created, which will be updated (if details like task or type have changed), and which old shifts will be deleted (if they are no longer in the spreadsheet). If a project address in the file doesn't exist, a new project will be created automatically. Once you are happy with the preview, you can uncheck 'Dry Run' and run the import for real.",
    imageId: "faq-import"
  },
  {
    question: "How do I manage users and approve new registrations? (Admin/Owner)",
    answer: "Go to the **'User Management'** page in the Admin Area. Here you can view all users. As an Owner, you can:\n\n- **Approve New Users**: New sign-ups appear in the 'Pending Applications' tab. Click 'Activate' to grant them access.\n- **Change Roles**: Promote users to Manager, TLO, or Admin.\n- **Set Details**: Assign an Operative ID, Trade, and Department to each user.\n- **Suspend/Delete**: Suspend accounts to temporarily revoke access, or permanently delete a user and all their data.",
    imageId: "faq-users"
  },
];


export function Faq() {
  return (
    <section id="faq" className="py-12 lg:py-24">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-headline font-bold">Frequently Asked Questions</h2>
          <p className="text-lg text-muted-foreground mt-2">
            Have questions? We've got answers.
          </p>
        </div>
        <Accordion type="single" collapsible className="w-full">
          {faqs.map((faq, index) => {
            const image = PlaceHolderImages.find(p => p.id === faq.imageId);
            return (
              <AccordionItem value={`item-${index}`} key={index} className="bg-background px-4 rounded-lg mb-2 shadow-sm">
                <AccordionTrigger className="text-lg text-left hover:no-underline">{faq.question}</AccordionTrigger>
                <AccordionContent className="text-base text-muted-foreground whitespace-pre-line">
                  <div className="space-y-4">
                    <p>{faq.answer}</p>
                    {image && (
                      <div className="relative mt-4 aspect-video overflow-hidden rounded-lg border">
                        <Image
                          src={image.imageUrl}
                          alt={image.description}
                          fill
                          className="object-cover"
                          data-ai-hint={image.imageHint}
                        />
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </div>
    </section>
  );
}
