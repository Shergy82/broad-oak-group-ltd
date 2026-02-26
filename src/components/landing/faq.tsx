"use client";

import { useMemo } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { UserProfile } from '@/types';

const allFaqs = [
  {
    question: "How do I see my upcoming shifts?",
    answer: "Your main Dashboard is your central hub for viewing your schedule. It is automatically filtered to show only shifts for your assigned department.\n\n- **Tabs**: Use the tabs (Today, This Week, Next Week, etc.) to navigate through your schedule.\n- **Today View**: This view is split into AM, PM, and All Day sections for a clear overview of your current day.\n- **Dismissing Shifts**: Once a shift is completed or marked as incomplete, you can use the 'Dismiss' button to hide it from your main view. This helps keep your dashboard tidy.",
    roles: ['user', 'admin', 'owner', 'manager', 'TLO'],
  },
  {
    question: "What is the lifecycle of a shift's status?",
    answer: "A shift progresses through several statuses, each with its own button on the shift card:\n\n1.  **Pending**: A new shift you haven't accepted yet. These appear in a pop-up dialog when you log in.\n2.  **Confirmed**: You have accepted the shift. Before starting, you can log any material purchases.\n3.  **On Site**: Click 'On Site' when you arrive at the job. This is crucial as it may unlock a checklist of tasks for the job.\n4.  **Complete / Incomplete**: When you finish, you must mark the shift as 'Complete' or 'Incomplete'. If 'Incomplete', you must write a note explaining why (e.g., 'Client not home', 'Waiting on materials'). This note is visible to administrators.",
    roles: ['user', 'admin', 'owner', 'manager', 'TLO'],
  },
  {
    question: "How do I use the on-shift Checklist?",
    answer: "For certain jobs, a checklist of required tasks will appear on the shift card after you have marked yourself as **'On Site'**. \n\nAs you finish each item, simply check the box next to it. If a task has a camera icon, a photo is required. Clicking the checkbox for a photo-required task will open your device's camera. The photo you take will be automatically timestamped, geotagged, and uploaded to the project's evidence folder with the correct tag.",
    roles: ['user', 'admin', 'owner', 'manager', 'TLO'],
  },
    {
    question: "How does the 'Share App' link work?",
    answer: "The 'Share App' button generates a special signup link that automatically assigns new users to a specific department, streamlining the onboarding process.\n\n- **For Admins/Managers/Users**: The link will always be for your own department.\n- **For Owners**: The link will be for the single department you have selected in your department filter. If you have multiple departments selected, you will be prompted to choose one first.",
    roles: ['user', 'admin', 'owner', 'manager', 'TLO'],
  },
  {
    question: "How does the Excel shift import work? (Admin)",
    answer: "The importer is designed to be strict to prevent errors. It will only assign a shift if it finds one, unambiguous user match.\n\n1.  **Use 'Dry Run'**: Always use the 'Dry Run' option first. This simulates the import and shows a detailed preview of creations, updates, and deletions without making any actual changes.\n2.  **Name Matching**: The system matches names from the sheet to users in the database. If a name is misspelled, ambiguous (e.g., 'Steve' matches 'Steve Rogers' and 'Steve Smith'), or not found, it will be flagged as a **Failed** item. The shift will not be created for anyone.\n3.  **Protected Manual Shifts**: Shifts added manually through the 'Add Shift' dialog are protected. The import process will never delete a manually added shift, even if it's not on the spreadsheet.",
    roles: ['admin', 'owner', 'manager'],
  },
  {
    question: "How does data separation between departments work?",
    answer: "The application enforces strict data segregation. As a user, TLO, or Manager, you can only see data (shifts, projects, users, stats, etc.) that belongs to your assigned department.\n\n**For Owners**: Owners have a special department filter in the user menu (top-right). You can select one or more departments to view their specific data, or select all to see everything. This filter applies across all admin pages, including the schedule, availability map, and dashboards.",
    roles: ['admin', 'owner', 'manager', 'TLO'],
  },
  {
    question: "How do I manage users and departments? (Admin/Owner)",
    answer: "Go to the **'User Management'** page. Here you can:\n\n- **Approve New Users**: New sign-ups appear in the 'Pending' tab. Click 'Activate' to grant them access.\n- **Assign Departments**: New and existing users can be assigned to a department from the 'Unassigned' tab or by editing their profile. This is a mandatory step for activating a user.\n- **Manage Roles**: Promote users to Manager, TLO, etc.\n- **Suspend/Delete**: Temporarily suspend accounts or permanently delete a user.",
    roles: ['admin', 'owner'],
  },
  {
    question: "How do I create a department-specific task list? (Admin/Owner)",
    answer: "On the **'Task Management'** page, you can create task categories (e.g., 'Plumber', 'Electrician').\n\n- **For Admins/Managers**: Any new category you create is automatically assigned to your department.\n- **For Owners**: If you have a single department selected in your header filter, the new category will be assigned to that department. If you have multiple or all departments selected, the category will be global and visible to everyone.",
    roles: ['admin', 'owner', 'manager'],
  },
];


export function Faq({ role }: { role?: UserProfile['role'] }) {
    const filteredFaqs = useMemo(() => {
    const userRole = role || 'user'; // Default to 'user' if no role is provided (e.g., not logged in)
    const isPrivileged = ['admin', 'owner', 'manager', 'TLO'].includes(userRole);

    if (isPrivileged) {
      return allFaqs; // Privileged users see all FAQs
    }
    
    // Standard users only see FAQs that include the 'user' role
    return allFaqs.filter(faq => faq.roles.includes('user'));
    
  }, [role]);

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
          {filteredFaqs.map((faq, index) => {
            return (
              <AccordionItem value={`item-${index}`} key={index} className="bg-background px-4 rounded-lg mb-2 shadow-sm">
                <AccordionTrigger className="text-lg text-left hover:no-underline">{faq.question}</AccordionTrigger>
                <AccordionContent className="text-base text-muted-foreground whitespace-pre-line">
                  <div className="space-y-4">
                    <p>{faq.answer}</p>
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
