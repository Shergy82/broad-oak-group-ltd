
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUserProfile } from '@/hooks/use-user-profile';
import type { UserProfile } from '@/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LayoutGrid, Settings, AlertTriangle, ArrowUp, ArrowDown, X, Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AvailabilityOverview } from './availability-overview';
import { PerformanceDashboard } from './performance-dashboard';
import { ContractStatsDashboard } from './contract-stats-dashboard';
import { TaskManager } from './task-manager';
import { ProjectManager } from './project-manager';
import { Spinner } from '../shared/spinner';
import { ShiftScheduleOverview } from './shift-schedule-overview';
import { HealthAndSafetyFileList } from '../health-and-safety/file-list';
import { Faq } from '../landing/faq';
import { UserManagement } from './user-management';

type WidgetKey = 'availability' | 'performance' | 'contracts' | 'tasks' | 'projects' | 'schedule' | 'users' | 'healthAndSafety' | 'help';

interface Widget {
  key: WidgetKey;
  title: string;
  description: string;
}

const ALL_WIDGETS: Widget[] = [
  { key: 'availability', title: 'Today\'s Availability', description: 'Quick overview of operative availability today.' },
  { key: 'schedule', title: 'Team Schedule', description: 'A real-time overview of all upcoming shifts for the team.' },
  { key: 'performance', title: 'Operative Performance', description: 'KPIs for all users, ranked.' },
  { key: 'contracts', title: 'Contract Dashboard', description: 'High-level statistics for each contract.' },
  { key: 'tasks', title: 'Task Management', description: 'Create and manage reusable tasks.' },
  { key: 'projects', title: 'Project Management', description: 'Create projects and manage files.' },
  { key: 'users', title: 'User Management', description: 'View and manage all user accounts.' },
  { key: 'healthAndSafety', title: 'Health & Safety', description: 'View and manage H&S documents.' },
  { key: 'help', title: 'Help & Support', description: 'Frequently asked questions.' },
];

const LS_KEY = 'admin_dashboard_widgets_v4';

const WIDGET_COMPONENTS: Record<WidgetKey, React.ComponentType<{ userProfile: UserProfile }>> = {
    availability: AvailabilityOverview as any,
    performance: PerformanceDashboard as any,
    contracts: ContractStatsDashboard as any,
    tasks: TaskManager as any,
    projects: ProjectManager,
    schedule: ShiftScheduleOverview,
    users: UserManagement as any,
    healthAndSafety: HealthAndSafetyFileList,
    help: Faq as any,
};


export function CustomizableDashboard() {
  const { userProfile, loading: profileLoading } = useUserProfile();
  const [widgetConfig, setWidgetConfig] = useState<WidgetKey[]>(['availability', 'contracts', 'schedule']);
  const [isClient, setIsClient] = useState(false);

  const enabledWidgets = useMemo(() => new Set(widgetConfig), [widgetConfig]);

  useEffect(() => {
    setIsClient(true);
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
            const validKeys = parsed.filter((key: any) => ALL_WIDGETS.some(w => w.key === key));
            setWidgetConfig(validKeys);
        }
      } else {
        // Default widgets
        setWidgetConfig(['availability', 'contracts', 'schedule']);
      }
    } catch (e) {
      console.error("Failed to load dashboard config from localStorage", e);
      setWidgetConfig(['availability', 'contracts', 'schedule']);
    }
  }, []);

  useEffect(() => {
    if (isClient) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(widgetConfig));
      } catch (e) {
        console.error("Failed to save dashboard config to localStorage", e);
      }
    }
  }, [widgetConfig, isClient]);

  const handleWidgetToggle = (key: WidgetKey, checked: boolean) => {
    setWidgetConfig(prev => {
        if (checked) {
            return prev.includes(key) ? prev : [...prev, key];
        } else {
            return prev.filter(k => k !== key);
        }
    });
  };

  const handleMove = (key: WidgetKey, direction: 'up' | 'down') => {
    setWidgetConfig(prev => {
        const currentIndex = prev.indexOf(key);
        if (currentIndex === -1) return prev;

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (newIndex < 0 || newIndex >= prev.length) return prev;

        const newConfig = [...prev];
        const temp = newConfig[currentIndex];
        newConfig[currentIndex] = newConfig[newIndex];
        newConfig[newIndex] = temp;
        
        return newConfig;
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

  const widgetsToRender = widgetConfig.map(key => ALL_WIDGETS.find(w => w.key === key)).filter((w): w is Widget => !!w);
  const enabledInOrder = widgetsToRender;
  const disabledButAvailable = ALL_WIDGETS.filter(w => !enabledWidgets.has(w.key));

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Control Panel</h1>
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline"><Settings className="mr-2 h-4 w-4" /> Customize Dashboard</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Customize Dashboard</DialogTitle>
                    <DialogDescription>Select and reorder the widgets you want to display on your control panel.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] -mx-4 px-4">
                    <div className="py-4 space-y-6">
                        <div>
                            <h4 className="mb-2 font-semibold text-muted-foreground">Enabled Widgets</h4>
                            <div className="space-y-2 rounded-md border p-2">
                                {enabledInOrder.length > 0 ? enabledInOrder.map((widget, index) => (
                                    <div key={widget.key} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                                        <div className="grid gap-1.5 leading-none">
                                            <Label className="font-medium">{widget.title}</Label>
                                            <p className="text-sm text-muted-foreground">{widget.description}</p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === 0} onClick={() => handleMove(widget.key, 'up')}>
                                                <ArrowUp className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === enabledInOrder.length - 1} onClick={() => handleMove(widget.key, 'down')}>
                                                <ArrowDown className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive" onClick={() => handleWidgetToggle(widget.key, false)}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )) : <p className="p-4 text-center text-sm text-muted-foreground">No widgets enabled. Add some from the list below.</p>}
                            </div>
                        </div>
                        
                        <div>
                            <h4 className="mb-2 font-semibold text-muted-foreground">Available Widgets</h4>
                            <div className="space-y-2 rounded-md border p-2">
                                {disabledButAvailable.length > 0 ? disabledButAvailable.map(widget => (
                                    <div key={widget.key} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                                        <div className="grid gap-1.5 leading-none">
                                            <Label className="font-medium">{widget.title}</Label>
                                            <p className="text-sm text-muted-foreground">{widget.description}</p>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" onClick={() => handleWidgetToggle(widget.key, true)}>
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )) : <p className="p-4 text-center text-sm text-muted-foreground">All available widgets are enabled.</p>}
                            </div>
                        </div>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
       </div>
       
       {widgetsToRender.length > 0 ? (
           <div className="space-y-6">
                {widgetsToRender.map(widget => {
                    const Component = WIDGET_COMPONENTS[widget.key];
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
                })}
           </div>
       ) : (
            <Card className="col-span-full">
                <CardContent className="p-12 text-center">
                    <LayoutGrid className="mx-auto h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 text-lg font-semibold">Dashboard is Empty</h3>
                    <p className="mt-2 text-sm text-muted-foreground">Use the "Customize Dashboard" button to add and arrange widgets.</p>
                </CardContent>
            </Card>
       )}
    </div>
  );
}
