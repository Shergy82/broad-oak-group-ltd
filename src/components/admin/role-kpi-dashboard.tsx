
'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Shift, UserProfile } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown, Users, BarChart } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PerformanceMetrics {
  userId: string;
  userName: string;
  totalShifts: number;
  completed: number;
  incomplete: number;
  completionRate: number;
  tasksDone: number;
}

interface RoleKpiDashboardProps {
  allShifts: Shift[];
  allUsers: UserProfile[];
}

const DEFAULT_ROLES: (UserProfile['role'])[] = ['manager', 'TLO', 'admin', 'owner'];
const LS_SHIFT_TASKS_KEY = 'shiftTaskCompletion_v2';

export function RoleKpiDashboard({ allShifts, allUsers }: RoleKpiDashboardProps) {
  const [selectedRoles, setSelectedRoles] = useState<Set<UserProfile['role']>>(new Set(DEFAULT_ROLES));
  const [shiftTaskData, setShiftTaskData] = useState<{[key: string]: object}>({});
  
  useEffect(() => {
    try {
      const storedData = localStorage.getItem(LS_SHIFT_TASKS_KEY);
      if (storedData) {
        setShiftTaskData(JSON.parse(storedData));
      }
    } catch (e) {
      console.error("Failed to load task completion data from localStorage", e);
    }
  }, []);

  const availableRoles = useMemo(() => {
    const roles = new Set(allUsers.map(u => u.role));
    const rolesToExclude: UserProfile['role'][] = ['user'];
    return Array.from(roles).filter(role => !rolesToExclude.includes(role)).sort();
  }, [allUsers]);

  const performanceDataByRole = useMemo(() => {
    const data: { [key in UserProfile['role']]?: PerformanceMetrics[] } = {};

    selectedRoles.forEach(role => {
      const usersInRole = allUsers.filter(u => u.role === role);
      
      const metrics = usersInRole
        .map(user => {
          const userShifts = allShifts.filter(s => s.userId === user.uid);
          const totalShifts = userShifts.length;

          if (totalShifts === 0) return null;

          const completed = userShifts.filter(s => s.status === 'completed').length;
          const incomplete = userShifts.filter(s => s.status === 'incomplete').length;
          
          const rateCalculationTotal = userShifts.filter(s => s.status !== 'pending-confirmation').length;
          const completionRate = rateCalculationTotal > 0 ? (completed / rateCalculationTotal) * 100 : 0;
          
          const tasksDone = userShifts.reduce((acc, shift) => {
              const shiftTasks = shiftTaskData[shift.id] || {};
              return acc + Object.keys(shiftTasks).length;
          }, 0);

          return {
            userId: user.uid,
            userName: user.name,
            totalShifts,
            completed,
            incomplete,
            completionRate,
            tasksDone,
          };
        })
        .filter((metric): metric is PerformanceMetrics => metric !== null);
      
      if (metrics.length > 0) {
        data[role] = metrics.sort((a, b) => b.completionRate - a.completionRate);
      }
    });

    return data;
  }, [allShifts, allUsers, selectedRoles, shiftTaskData]);
  
  const handleRoleToggle = (role: UserProfile['role']) => {
      setSelectedRoles(prev => {
          const newRoles = new Set(prev);
          if (newRoles.has(role)) {
              newRoles.delete(role);
          } else {
              newRoles.add(role);
          }
          return newRoles;
      })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <CardTitle>Role-Based KPIs</CardTitle>
            <CardDescription>
              Performance metrics for users in specific roles.
            </CardDescription>
          </div>
           <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline">
                    Select Roles <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
                <ScrollArea className="h-72">
                    {availableRoles.map(role => (
                        <DropdownMenuCheckboxItem
                            key={role}
                            checked={selectedRoles.has(role)}
                            onCheckedChange={() => handleRoleToggle(role)}
                            className="capitalize"
                        >
                            {role}
                        </DropdownMenuCheckboxItem>
                    ))}
                </ScrollArea>
            </DropdownMenuContent>
           </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(performanceDataByRole).length > 0 ? (
          Object.entries(performanceDataByRole).map(([role, metrics]) => (
            <div key={role}>
              <h3 className="text-lg font-semibold capitalize mb-2 flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                {role} KPIs
              </h3>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead className="text-center">Total Shifts</TableHead>
                      <TableHead className="text-center">Tasks Done</TableHead>
                      <TableHead className="text-center">Completed</TableHead>
                      <TableHead className="text-center">Incomplete</TableHead>
                      <TableHead className="text-right">Completion Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.map(data => (
                      <TableRow key={data.userId}>
                        <TableCell className="font-medium">{data.userName}</TableCell>
                        <TableCell className="text-center">{data.totalShifts}</TableCell>
                        <TableCell className="text-center">{data.tasksDone}</TableCell>
                        <TableCell className="text-center">{data.completed}</TableCell>
                        <TableCell className="text-center">{data.incomplete}</TableCell>
                        <TableCell className="text-right font-semibold text-primary">{data.completionRate.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))
        ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                <BarChart className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Data for Selected Roles</h3>
                <p className="mb-4 mt-2 text-sm text-muted-foreground">
                    No users in the selected roles have assigned shifts, or no roles are selected.
                </p>
            </div>
        )}
      </CardContent>
    </Card>
  );
}
