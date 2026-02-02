
'use client';

import { Header } from '@/components/layout/header';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { HelpCircle, Bell, ThumbsUp, HardHat, CheckCircle2, XCircle, Megaphone, TrendingUp, Briefcase, SunMoon, Shield, Building2, Fingerprint, Users, CheckSquare, CalendarCheck, BarChart2, Camera } from 'lucide-react';
import { useUserProfile } from '@/hooks/use-user-profile';

export default function HelpPage() {
  const { userProfile } = useUserProfile();
  const isPrivilegedUser = userProfile && ['admin', 'owner', 'manager'].includes(userProfile.role);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
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
                  <p>Your User Dashboard is the main screen for managing your active work. It's organized into several tabs to help you see what's important:</p>
                  <ul className="list-disc pl-6 space-y-2">
                    <li><strong>Today:</strong> Shows all your shifts scheduled for the current day, separated into AM, PM, and All Day sections.</li>
                    <li><strong>This Week:</strong> Gives you an overview of all your active shifts for the current week, organized by day.</li>
                    <li><strong>Next Week / Week 3 / Week 4:</strong> Shows you all your scheduled shifts for the upcoming weeks.</li>
                    <li><strong>Last Week:</strong> Shows your active shifts from the previous week, allowing you to complete any you may have missed.</li>
                  </ul>
                   <p>Your dashboard also shows a section for "Recently Completed & Incomplete" shifts from the last four weeks. You can dismiss these from your view once you've reviewed them.</p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="item-2">
                <AccordionTrigger>Managing Your Shifts: The Shift Lifecycle</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <p>Each shift you are assigned follows a simple, multi-step process. You are responsible for updating the status of your shifts as you complete them.</p>
                  
                  <div className="space-y-4 rounded-lg border p-4">
                    <h4 className="font-semibold flex items-center gap-2"><ThumbsUp className="h-5 w-5 text-accent-foreground" />1. Accepting a New Shift</h4>
                    <p>When you are assigned new shifts, you will see a pop-up when you log in. You must accept the shifts to confirm you have received them. This moves their status from "Pending" to "Confirmed".</p>
                  </div>

                  <div className="space-y-4 rounded-lg border p-4">
                    <h4 className="font-semibold flex items-center gap-2"><HardHat className="h-5 w-5 text-teal-500" />2. Going On Site</h4>
                    <p>Once you have accepted a shift, the "Accept" button will be replaced with an "On Site" button. You should click this button as soon as you arrive at the work location. This lets the admins know you have started.</p>
                  </div>
                  
                  <div className="space-y-4 rounded-lg border p-4">
                    <h4 className="font-semibold flex items-center gap-2"><CheckSquare className="h-5 w-5 text-blue-600" />3. Using Checklists</h4>
                    <p>When you are on site, some shifts may display a checklist of tasks. You must complete this checklist before you can mark the shift as "Complete".</p>
                     <ul className="list-disc pl-6 space-y-2 text-sm">
                      <li>Check the box for each task as you finish it.</li>
                      <li>If a task requires a photo (<Camera className="inline h-4 w-4" />), checking the box will open your device's camera to take a picture. This photo is automatically uploaded to the project.</li>
                      <li>If you cannot complete a task, click the 'X' button (<XCircle className="inline h-4 w-4 text-destructive/70" />) next to it. You will be required to provide a brief reason. This is crucial feedback for the admin team.</li>
                   </ul>
                  </div>

                  <div className="space-y-4 rounded-lg border p-4">
                    <h4 className="font-semibold flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-600" />4. Completing a Shift</h4>
                    <p>After you are on site (and have completed the checklist, if there is one), the buttons will change to "Complete" and "Incomplete". When you have finished the work for that shift, click the "Complete" button. The shift will then move to your history.</p>
                  </div>

                  <div className="space-y-4 rounded-lg border p-4">
                    <h4 className="font-semibold flex items-center gap-2"><XCircle className="h-5 w-5 text-amber-600" />5. Marking a Shift as Incomplete</h4>
                    <p>If you are unable to complete a shift for any reason (e.g., waiting for materials, client not home), click the "Incomplete" button. You will be asked to write a short note explaining why. This note is important for the admin team, so please be clear and concise.</p>
                  </div>
                </AccordionContent>
              </AccordionItem>
              
               <AccordionItem value="item-site-schedule">
                <AccordionTrigger>Site Schedule View</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <p>The "Site Schedule" page provides a comprehensive view of all work scheduled for a specific property. This is useful for seeing who else is scheduled to be on a site and when.</p>
                  </div>
                   <ul className="list-disc pl-6 space-y-2">
                      <li>Use the search bar and dropdown to find a property address.</li>
                      <li>Once selected, you can view the schedule for last week, this week, and future weeks.</li>
                      <li>You can also download a PDF of the schedule for the selected property.</li>
                   </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="item-digital-sign-in">
                <AccordionTrigger>Digital Sign In/Out</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Fingerprint className="h-5 w-5 text-muted-foreground" />
                    <p>The "Digital Sign In/Out" link in the main menu will take you to a separate application to log your presence on-site for health and safety compliance.</p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="item-announcements">
                <AccordionTrigger>Announcements</AccordionTrigger>
                <AccordionContent className="space-y-4">
                   <div className="flex items-center gap-2">
                    <Megaphone className="h-5 w-5 text-muted-foreground" />
                    <p>When there are new, important announcements, you will see a pop-up when you first log in. You must read and acknowledge them before you can proceed. You can access all announcements from the user menu.</p>
                   </div>
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-stats">
                <AccordionTrigger>Your Stats</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-muted-foreground" />
                    <p>The "Stats" page shows your all-time performance data and a team leaderboard, recognizing top performers for the week, month, and all time based on shift completion rates.</p>
                  </div>
                </AccordionContent>
              </AccordionItem>
              
               <AccordionItem value="item-projects">
                <AccordionTrigger>Projects & Files</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-5 w-5 text-muted-foreground" />
                    <p>The "Projects" page lists company projects. You can find and download project-specific documents and upload new files like photos or delivery notes.</p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="item-hs">
                <AccordionTrigger>Health & Safety</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    <HardHat className="h-5 w-5 text-muted-foreground" />
                    <p>This link takes you to a shared Google Drive folder containing important health and safety documents, which you can view or download.</p>
                  </div>
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-notifications">
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
            
             {isPrivilegedUser && (
                <>
                    <CardTitle className="flex items-center gap-3 pt-8">
                        <Shield className="h-8 w-8 text-primary" />
                        Admin Guide
                    </CardTitle>
                    <AccordionItem value="admin-dashboard">
                        <AccordionTrigger>Admin Dashboard</AccordionTrigger>
                        <AccordionContent className="space-y-4">
                          <p>The Admin Dashboard is the central hub for bulk operations and high-level overviews.</p>
                          <ul className="list-disc pl-6 space-y-2">
                              <li><strong>Today's Availability:</strong> A quick view of which operatives are working, fully available, or semi-available today.</li>
                              <li><strong>Daily Wrap-up:</strong> Download a PDF report summarizing all of yesterday's shift activity.</li>
                              <li><strong>Import Shifts:</strong> Upload an Excel workbook to create, update, and delete shifts in bulk. Use the "Dry Run" option to preview changes before publishing.</li>
                              <li><strong>Contract Dashboard:</strong> View high-level statistics for each contract, derived from your imported Excel sheets.</li>
                              <li><strong>Role-Based KPIs:</strong> See performance metrics for users in specific roles like Manager or TLO.</li>
                          </ul>
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="admin-schedule">
                        <AccordionTrigger>Team Schedule</AccordionTrigger>
                        <AccordionContent className="space-y-4">
                          <p>The Team Schedule provides a master view of all shifts for all users. You can filter by user and view shifts for today, this week, and future weeks. It also includes a 6-week archive of completed/incomplete shifts.</p>
                          <ul className="list-disc pl-6 space-y-2">
                              <li><strong>Add/Edit/Delete Shifts:</strong> Privileged users can manually manage shifts directly from this view.</li>
                              <li><strong>Download Reports:</strong> Download detailed PDF reports for the day or week, providing a summary of all activities.</li>
                          </ul>
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="admin-tasks">
                        <AccordionTrigger>Task Management</AccordionTrigger>
                        <AccordionContent className="space-y-4">
                            <div className="flex items-center gap-2">
                                <CheckSquare className="h-5 w-5 text-muted-foreground" />
                                <p>The "Tasks" page allows you to create and manage reusable checklists organized by category (e.g., a trade like 'Plumber' or a role like 'TLO'). These checklists will automatically appear on shifts for users who have that trade/role assigned to them.</p>
                           </div>
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="admin-availability">
                        <AccordionTrigger>Operative Availability</AccordionTrigger>
                        <AccordionContent className="space-y-4">
                            <div className="flex items-center gap-2">
                                <CalendarCheck className="h-5 w-5 text-muted-foreground" />
                                <p>The "Availability" page provides a powerful tool to see which operatives are free on any given day or date range. You can filter by role or trade, and even add periods of unavailability (like holidays) for any user.</p>
                           </div>
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="admin-contracts">
                        <AccordionTrigger>Contracts Dashboard</AccordionTrigger>
                        <AccordionContent className="space-y-4">
                             <div className="flex items-center gap-2">
                                <Briefcase className="h-5 w-5 text-muted-foreground" />
                                <p>The "Contracts" page shows high-level statistics for each contract. The contract name is taken from the sheet name in your Excel import file. You can filter by manager or contract to see metrics like number of jobs, operatives, and shifts.</p>
                           </div>
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="admin-performance">
                        <AccordionTrigger>Operative Performance</AccordionTrigger>
                        <AccordionContent className="space-y-4">
                           <div className="flex items-center gap-2">
                                <BarChart2 className="h-5 w-5 text-muted-foreground" />
                                <p>The Performance page provides key metrics on operative efficiency. You can filter the data by week, month, or all time. Metrics include total shifts assigned, completion rate, and incomplete rate, sorted from best to worst performance.</p>
                           </div>
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="admin-users">
                        <AccordionTrigger>User Management</AccordionTrigger>
                        <AccordionContent className="space-y-4">
                          <p>This page allows you to view and manage all registered users.</p>
                          <ul className="list-disc pl-6 space-y-2">
                              <li><strong>View Users:</strong> See a list of all users, their roles, and their status.</li>
                              <li><strong>Set Operative ID, Trade & Type:</strong> Assign an Operative ID, define their trade/role for checklists, and set their employment type (Direct/Subbie).</li>
                              <li><strong>Activate/Suspend Users:</strong> Owners can approve new user registrations or suspend existing accounts.</li>
                               <li><strong>Delete Users:</strong> Owners can permanently delete user accounts.</li>
                              <li><strong>Download Directory:</strong> Generate a PDF directory of all operatives, separated by employment type.</li>
                          </ul>
                        </AccordionContent>
                    </AccordionItem>
                </>
             )}

            </Accordion>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

    