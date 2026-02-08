
'use client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { HelpCircle, Bell, ThumbsUp, HardHat, CheckCircle2, XCircle, Megaphone, TrendingUp, Briefcase, SunMoon } from 'lucide-react';

export default function HelpPage() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
              <HelpCircle className="h-8 w-8 text-primary" />
              Help & Support
          </CardTitle>
          <CardDescription>
            A guide to using the features available to you in the app. Click on any topic to see more details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            
            <AccordionItem value="item-1">
              <AccordionTrigger>Your Dashboard: Viewing Your Schedule</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <p>Your Dashboard is the main screen for managing your work. It's organized into three tabs:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li><strong>Today:</strong> Shows all your shifts scheduled for the current day, separated into AM, PM, and All Day sections.</li>
                  <li><strong>This Week:</strong> Gives you an overview of all your shifts for the current week, organized by day.</li>
                  <li><strong>Next Week:</strong> Shows you all your scheduled shifts for the upcoming week.</li>
                </ul>
                 <p>From here, you can see the details of each shift and perform actions on them.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-2">
              <AccordionTrigger>Managing Your Shifts: The Shift Lifecycle</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <p>Each shift you are assigned follows a simple, multi-step process. You are responsible for updating the status of your shifts as you complete them.</p>
                
                <div className="space-y-4 rounded-lg border p-4">
                  <h4 className="font-semibold flex items-center gap-2"><ThumbsUp className="h-5 w-5 text-accent" />1. Accepting a New Shift</h4>
                  <p>When you are assigned a new shift, you will see a pop-up dialog when you log in. You must accept the shift to confirm you have received it. You can either accept shifts one-by-one or all at once.</p>
                </div>

                <div className="space-y-4 rounded-lg border p-4">
                  <h4 className="font-semibold flex items-center gap-2"><HardHat className="h-5 w-5 text-teal-500" />2. Going On Site</h4>
                  <p>Once you have accepted a shift, the "Accept" button will be replaced with an "On Site" button. You should click this button as soon as you arrive at the work location. This lets the admins know you have started.</p>
                </div>
                
                <div className="space-y-4 rounded-lg border p-4">
                  <h4 className="font-semibold flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-600" />3. Completing a Shift</h4>
                  <p>After you are on site, the buttons will change to "Complete" and "Incomplete". When you have finished the work for that shift, click the "Complete" button. The shift will then move to your history.</p>
                </div>

                <div className="space-y-4 rounded-lg border p-4">
                  <h4 className="font-semibold flex items-center gap-2"><XCircle className="h-5 w-5 text-amber-600" />4. Marking a Shift as Incomplete</h4>
                  <p>If you are unable to complete a shift for any reason (e.g., waiting for materials, client not home), click the "Incomplete" button. You will be asked to write a short note explaining why. This note is important for the admin team, so please be clear and concise.</p>
                </div>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-3">
              <AccordionTrigger>Announcements</AccordionTrigger>
              <AccordionContent className="space-y-4">
                 <div className="flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-muted-foreground" />
                  <p>When there are new, important announcements from the company, you will see a pop-up when you first log in. You must read and acknowledge these announcements before you can proceed to your dashboard.</p>
                 </div>
                <p>You can also access all past and present announcements by clicking on your profile icon in the top-right and selecting "Announcements" from the menu.</p>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-4">
              <AccordionTrigger>Your Stats</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
                  <p>The "Stats" page (available in the user menu) shows your all-time performance data, including:</p>
                </div>
                <ul className="list-disc pl-6 space-y-2">
                  <li><strong>Total Shifts:</strong> The total number of shifts you have ever been assigned.</li>
                  <li><strong>Completed:</strong> The total number of shifts you have successfully marked as completed.</li>
                  <li><strong>Incomplete:</strong> The total number of shifts you have marked as incomplete.</li>
                  <li><strong>Completion Rate:</strong> The percentage of your shifts that are marked as completed.</li>
                </ul>
                <p>This page also includes a "Team Leaderboard" to recognize top performers.</p>
              </AccordionContent>
            </AccordionItem>
            
             <AccordionItem value="item-5">
              <AccordionTrigger>Projects & Files</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-muted-foreground" />
                  <p>The "Projects" page lists all company projects. You can use this page to find project-specific documents.</p>
                </div>
                <p>Each project card has an "Attached Files" section. From here, you can:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li><strong>View and Download:</strong> See a list of all files for a project and download them by clicking the download icon.</li>
                  <li><strong>Upload:</strong> You can upload new files (like photos or documents) to a project using the "Upload File" button.</li>
                  <li><strong>Delete:</strong> You can delete any file that you originally uploaded.</li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-6">
              <AccordionTrigger>Health & Safety Documents</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <HardHat className="h-5 w-5 text-muted-foreground" />
                  <p>From the main menu, select "Health & Safety" to access a shared folder of important documents. Click the button on this page to open the folder and explore the files.</p>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-7">
              <AccordionTrigger>Annual Leave & Sickness</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <SunMoon className="h-5 w-5 text-muted-foreground" />
                  <p>The "Annual Leave & Sickness" link in the main menu will take you to a separate application to manage your time off.</p>
                </div>
                <p>You will need to create an account in this separate application to register and report any sickness or holiday requests.</p>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-8">
              <AccordionTrigger>Enabling Push Notifications</AccordionTrigger>
              <AccordionContent>
                <Alert>
                  <Bell className="h-4 w-4" />
                  <AlertTitle>Get Real-Time Updates!</AlertTitle>
                  <AlertDescription>
                      <p className="mb-2">To get instant notifications about new or updated shifts, you need to enable push notifications in your browser.</p>
                      <ol className="list-decimal pl-5 space-y-1">
                          <li>Click the bell icon (<Bell className="inline h-4 w-4" />) in the top-right corner of the app header.</li>
                          <li>Your browser will ask for permission to show notifications. Click "Allow".</li>
                          <li>The bell icon will turn solid and colored, confirming you are subscribed.</li>
                      </ol>
                      <p className="mt-3">If you have previously blocked notifications, you will need to go into your browser's site settings to allow them manually.</p>
                  </AlertDescription>
                </Alert>
              </AccordionContent>
            </AccordionItem>

          </Accordion>
        </CardContent>
      </Card>
    </main>
  );
}
