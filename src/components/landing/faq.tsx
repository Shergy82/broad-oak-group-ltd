"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "How do I see my upcoming shifts?",
    answer: "Your main Dashboard page shows all your assigned shifts. You can use the tabs to switch between 'Today', 'This Week', 'Next Week', and further in the future. Completed or Incomplete shifts from the past month are available in the 'Recently Completed' section at the bottom.",
  },
  {
    question: "How do I confirm a new shift I've been assigned?",
    answer: "When you are assigned new shifts, a pop-up window will appear when you log in, listing the new assignments. Review the details and click the 'Accept All' button to confirm them.",
  },
  {
    question: "How do I update the status of a shift (e.g., 'On Site', 'Completed')?",
    answer: "On your Dashboard, each shift card has action buttons. When you arrive at a job, click 'On Site'. When you're finished, you can mark it as 'Complete' or 'Incomplete'. If you mark it as 'Incomplete', you'll be prompted to add a note explaining why.",
  },
   {
    question: "What is the 'Checklist' on a shift card for?",
    answer: "Some jobs require a checklist of tasks to be completed. You can find this on the shift card after you've marked yourself as 'On Site'. Check off each task as you complete it. Some tasks may require you to take a photo as evidence.",
  },
  {
    question: "How do I upload files or photos to a project?",
    answer: "Navigate to the 'Projects' page from the main menu. Each project has a file management section where you can upload documents or photos directly from your device.",
  },
  {
    question: "What is the 'Evidence' dashboard for? (Admin)",
    answer: "The Evidence Dashboard provides an at-a-glance view of all projects and their photo evidence requirements. Cards are color-coded: Red for incomplete evidence, Orange when all evidence is present and ready for a PDF report, and Green after a report has been generated.",
  },
  {
    question: "How do I import shifts from an Excel file? (Admin)",
    answer: "In the header, click the 'Import Shifts' button. This will open a panel where you can upload your Excel file. You can then select which sheets to import and run a 'Dry Run' to preview all changes (new shifts, updates, deletions) before committing them to the live schedule.",
  },
   {
    question: "How do I manage user accounts and approve new registrations? (Admin)",
    answer: "Go to the 'User Management' page in the Admin Area. Here you can view all users, edit their roles and details, or approve new users who have registered. New registrations will appear under the 'Pending Applications' tab.",
  },
  {
    question: "Where can I see a map of all operatives' locations for today? (Admin)",
    answer: "The 'Mapping' page in the Admin Area shows a live map of all operatives with shifts scheduled for the current day. You can use the search bar to find and focus on a specific user's location.",
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
          {faqs.map((faq, index) => (
            <AccordionItem value={`item-${index}`} key={index} className="bg-background px-4 rounded-lg mb-2 shadow-sm">
              <AccordionTrigger className="text-lg text-left hover:no-underline">{faq.question}</AccordionTrigger>
              <AccordionContent className="text-base text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
