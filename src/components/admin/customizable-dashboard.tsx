'use client';

import { useState, useEffect } from 'react';
import { useUserProfile } from '@/hooks/use-user-profile';
import type { UserProfile } from '@/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LayoutGrid, Settings, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AvailabilityOverview } from './availability-overview';
import { PerformanceDashboard } from './performance-dashboard';
import { ContractStatsDashboard } from './contract-stats-dashboard';
import { TaskManager } from './task-manager';
import { ProjectManager } from './project-manager';
import { Spinner } from '../shared/spinner';

type WidgetKey = 'availability' | 'performance' | 'contracts' | 'tasks' | 'projects';

interface Widget {
  key: WidgetKey;
  title: string;
  description: string;
}

const ALL_WIDGETS: Widget[] = [
  { key: 'availability', title: 'Today\'s Availability', description: 'Quick overview of operative availability today.' },
  { key: 'performance', title: 'Operative Performance', description: 'KPIs for all users, ranked.' },
  { key: 'contracts', title: 'Contract Dashboard', description: 'High-level statistics for each contract.' },
  { key: 'tasks', title: 'Task Management', description: 'Create and manage reusable tasks.' },
  { key: 'projects', title: 'Project Management', description: 'Create projects and manage files.' },
];

const LS_KEY = 'admin_dashboard_widgets_v2';

const WIDGET_COMPONENTS: Record<WidgetKey, React.ComponentType<{ userProfile: UserProfile }>> = {
    availability: AvailabilityOverview as any,
    performance: PerformanceDashboard as any,
    contracts: ContractStatsDashboard as any,
    tasks: TaskManager as any,
    projects: ProjectManager
};


export function CustomizableDashboard() {
  const { userProfile, loading: profileLoading } = useUserProfile();
  const [enabledWidgets, setEnabledWidgets] = useState<Set<WidgetKey>>(new Set(['importer']));
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const validKeys = parsed.filter((key: any) => ALL_WIDGETS.some(w => w.key === key));
        setEnabledWidgets(new Set(validKeys));
      } else {
        // Default widgets
        setEnabledWidgets(new Set(['availability', 'projects']));
      }
    } catch (e) {
      console.error("Failed to load dashboard config from localStorage", e);
      setEnabledWidgets(new Set(['availability', 'projects']));
    }
  }, []);

  useEffect(() => {
    if (isClient) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(Array.from(enabledWidgets)));
      } catch (e) {
        console.error("Failed to save dashboard config to localStorage", e);
      }
    }
  }, [enabledWidgets, isClient]);

  const handleWidgetToggle = (key: WidgetKey, checked: boolean) => {
    setEnabledWidgets(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(key);
      } else {
        newSet.delete(key);
      }
      return newSet;
    });
  };

  if (profileLoading || !isClient) {
    return <div className="flex justify-center items-center h-64"><Spinner size="lg" /></div>
  }
  
  if (!userProfile) {
    return <div>Could not load user profile.</div>;
  }
  
  const isPrivileged = ['admin', 'owner', 'manager'].includes(userProfile.role);

  if (!isPrivileged) {
      return (
          <Card>
              <CardHeader>
                  <CardTitle className="flex items-center gap-2"><AlertTriangle /> Access Denied</CardTitle>
              </CardHeader>
              <CardContent>
                  <p>You do not have permission to view the admin control panel.</p>
              </CardContent>
          </Card>
      )
  }

  const largeWidgetKeys: WidgetKey[] = ['performance', 'contracts', 'tasks', 'projects'];
  const smallWidgets = ALL_WIDGETS.filter(
    w => enabledWidgets.has(w.key) && !largeWidgetKeys.includes(w.key)
  );
  const largeWidgets = ALL_WIDGETS.filter(
    w => enabledWidgets.has(w.key) && largeWidgetKeys.includes(w.key)
  );
  const widgetsToRender = [...smallWidgets, ...largeWidgets];


  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Control Panel</h1>
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline"><Settings className="mr-2 h-4 w-4" /> Customize Dashboard</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Customize Dashboard</DialogTitle>
                    <DialogDescription>Select the widgets you want to display on your control panel.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-96 pr-4">
                    <div className="space-y-4 py-4">
                        {ALL_WIDGETS.map(widget => (
                            <div key={widget.key} className="flex items-start space-x-3 rounded-md border p-4">
                               <Checkbox 
                                   id={widget.key} 
                                   checked={enabledWidgets.has(widget.key)} 
                                   onCheckedChange={(checked) => handleWidgetToggle(widget.key, !!checked)}
                               />
                                <div className="grid gap-1.5 leading-none">
                                    <Label htmlFor={widget.key} className="font-medium cursor-pointer">{widget.title}</Label>
                                    <p className="text-sm text-muted-foreground">{widget.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
       </div>
       
       {widgetsToRender.length > 0 ? (
           <div className="space-y-6">
                {smallWidgets.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                        {smallWidgets.map(widget => {
                            const Component = WIDGET_COMPONENTS[widget.key];
                            return <Component key={widget.key} userProfile={userProfile} />;
                        })}
                    </div>
                )}
                
                {largeWidgets.length > 0 && (
                    <div className="space-y-6">
                        {largeWidgets.map(widget => {
                            const Component = WIDGET_COMPONENTS[widget.key];
                            if (widget.key === 'projects') {
                                return (
                                    <Card key={widget.key}>
                                        <CardHeader>
                                            <CardTitle>{widget.title}</CardTitle>
                                            <CardDescription>{widget.description}</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <Component userProfile={userProfile} />
                                        </CardContent>
                                    </Card>
                                )
                            }
                            return <Component key={widget.key} userProfile={userProfile} />;
                        })}
                    </div>
                )}
           </div>
       ) : (
            <Card className="col-span-full">
                <CardContent className="p-12 text-center">
                    <LayoutGrid className="mx-auto h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 text-lg font-semibold">Dashboard is Empty</h3>
                    <p className="mt-2 text-sm text-muted-foreground">Use the "Customize Dashboard" button to add some widgets.</p>
                </CardContent>
            </Card>
       )}
    </div>
  );
}
