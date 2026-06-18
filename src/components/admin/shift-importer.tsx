'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader } from './file-uploader';
import type { UserProfile, Shift } from '@/types';
import { Button } from '@/components/ui/button';
import { db, functions, httpsCallable } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { type UnifiedParseResult } from '@/lib/exceljs-parser';
import { type StandardShift } from '@/lib/importer/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle, Info, RotateCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/shared/spinner';

interface DryRunResult extends UnifiedParseResult {
  toCreate: StandardShift[];
  toUpdate: { id: string; old: Shift; new: StandardShift }[];
  toDelete: Shift[];
}

interface ShiftImporterProps {
  userProfile: UserProfile;
}

function serializeDate(value: any): string {
  if (!value) throw new Error('Invalid date: empty value');

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid date: bad Date object');
    return value.toISOString();
  }

  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date: bad Firestore Timestamp');
    return d.toISOString();
  }

  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }

  if (typeof value === 'object' && typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000).toISOString();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  throw new Error(`Invalid date: ${JSON.stringify(value)}`);
}

function getDateForSort(value: any): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'object' && typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'object' && typeof value._seconds === 'number') return value._seconds * 1000;

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function getDateForDisplay(value: any): Date {
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  if (typeof value === 'object' && typeof value._seconds === 'number') return new Date(value._seconds * 1000);

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function prepareShiftForPublish(shift: StandardShift, profileId: string) {
  return {
    ...shift,
    date: serializeDate(shift.date),
    status: 'pending',
    source: 'import',
    plannerName: profileId,
    profileId,
    operativeUid: shift.operativeUid,
  };
}

export function ShiftImporter({ userProfile }: ShiftImporterProps) {
  const { user } = useAuth();
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const { toast } = useToast();

  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    getDocs(collection(db, 'users')).then((snap) => {
      setAllUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() } as UserProfile)));
    });
  }, []);

  const userNameMap = useMemo(
    () => new Map(allUsers.map((u) => [u.uid, u.name])),
    [allUsers]
  );

  const handleImportComplete = (result: DryRunResult) => {
    setDryRun(result);
  };

  const handleFinalPublish = async () => {
    if (!dryRun || !user) return;

    setIsPublishing(true);

    try {
      if (!functions) throw new Error('Functions not available');

      const reconcileShifts = httpsCallable(functions, 'reconcileShifts');

      const toCreatePayload = dryRun.toCreate.map((shift) =>
        prepareShiftForPublish(shift, dryRun.profileId)
      );

      const toUpdatePayload = dryRun.toUpdate.map(({ id, new: n }) => ({
        id,
        new: prepareShiftForPublish(n, dryRun.profileId)
      }));

      const toDeletePayload = dryRun.toDelete.map((shift) => ({
        id: shift.id
      }));

      await reconcileShifts({
        toCreate: toCreatePayload,
        toUpdate: toUpdatePayload,
        toDelete: toDeletePayload,
        department: userProfile.department || 'Gas',
        profileId: dryRun.profileId,
      });

      await addDoc(collection(db, 'import_logs'), {
        fileName: dryRun.profileId,
        importerUid: user.uid,
        importerName: userProfile.name,
        profileId: dryRun.profileId,
        newCount: dryRun.toCreate.length,
        updateCount: dryRun.toUpdate.length,
        deleteCount: dryRun.toDelete.length,
        importedShiftCount: dryRun.shifts.length,
        timestamp: serverTimestamp(),
        result: 'success',
      });

      toast({
        title: 'Success',
        description: 'Schedule synchronized successfully.',
      });

      setDryRun(null);
    } catch (err: any) {
      console.error('Publish failed:', err);
      toast({
        variant: 'destructive',
        title: 'Sync Failed',
        description: err?.message || 'Unknown publish error',
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const renderDryRunResults = (result: DryRunResult) => {
    const notImported = (result.errors || []).filter(
      (err) => err.severity === 'error' || err.severity === 'warning'
    );

    const sortedNew = [...result.toCreate].sort(
      (a, b) => getDateForSort(a.date) - getDateForSort(b.date)
    );

    const sortedUpdates = [...result.toUpdate].sort(
      (a, b) => getDateForSort(a.new.date) - getDateForSort(b.new.date)
    );

    const sortedDeletions = [...result.toDelete].sort(
      (a, b) => getDateForSort(a.date) - getDateForSort(b.date)
    );

    const totalChanges = sortedNew.length + sortedUpdates.length + sortedDeletions.length;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-green-50 border-green-200">
            <CardHeader className="p-3">
              <CardTitle className="text-xs text-green-700 uppercase">New</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-green-700">{sortedNew.length}</p>
            </CardContent>
          </Card>

          <Card className="bg-blue-50 border-blue-200">
            <CardHeader className="p-3">
              <CardTitle className="text-xs text-blue-700 uppercase">Updates</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-blue-700">{sortedUpdates.length}</p>
            </CardContent>
          </Card>

          <Card className="bg-amber-50 border-amber-200">
            <CardHeader className="p-3">
              <CardTitle className="text-xs text-amber-700 uppercase">Deletions</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-amber-700">{sortedDeletions.length}</p>
            </CardContent>
          </Card>

          <Card className={cn(notImported.length > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200')}>
            <CardHeader className="p-3">
              <CardTitle className={cn('text-xs uppercase', notImported.length > 0 ? 'text-red-700' : 'text-slate-700')}>
                Not Imported
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className={cn('text-2xl font-bold', notImported.length > 0 && 'text-red-700')}>
                {notImported.length}
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="create">New ({sortedNew.length})</TabsTrigger>
            <TabsTrigger value="update">Updates ({sortedUpdates.length})</TabsTrigger>
            <TabsTrigger value="delete">Deletions ({sortedDeletions.length})</TabsTrigger>
            <TabsTrigger value="failed" className={cn(notImported.length > 0 && 'text-red-600')}>
              Not Imported ({notImported.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Task</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedNew.length > 0 ? (
                    sortedNew.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{format(getDateForDisplay(s.date), 'dd/MM/yy')}</TableCell>
                        <TableCell className="font-semibold text-xs text-primary">{s.operative}</TableCell>
                        <TableCell className="text-[10px] truncate max-w-[150px]">{s.address}</TableCell>
                        <TableCell className="text-[10px] italic">{s.task}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                        No changes to import.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="update">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Task Update</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedUpdates.length > 0 ? (
                    sortedUpdates.map((u, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{format(getDateForDisplay(u.new.date), 'dd/MM/yy')}</TableCell>
                        <TableCell className="text-xs">{u.new.operative}</TableCell>
                        <TableCell className="text-[10px] font-medium text-blue-700">{u.new.task}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-10 text-muted-foreground">
                        No updates needed.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="delete">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedDeletions.length > 0 ? (
                    sortedDeletions.map((s, i) => (
                      <TableRow key={i} className="bg-amber-50">
                        <TableCell className="text-xs">{format(getDateForDisplay(s.date), 'dd/MM/yy')}</TableCell>
                        <TableCell className="text-xs">{userNameMap.get(s.userId) || s.userName || 'Unknown'}</TableCell>
                        <TableCell className="text-[10px]">{s.address}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-10 text-muted-foreground">
                        No deletions detected.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="failed">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Cell</TableHead>
                    <TableHead>Found Text</TableHead>
                    <TableHead>Reason Not Imported</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notImported.length > 0 ? (
                    notImported.map((err, i) => (
                      <TableRow key={i} className="bg-red-50/50">
                        <TableCell className="text-[10px] font-bold">{err.cell || '?'}</TableCell>
                        <TableCell className="text-[10px] truncate max-w-[200px] italic">
                          "{err.rawValues?.text || 'N/A'}"
                        </TableCell>
                        <TableCell className="text-[10px] font-semibold text-red-700">{err.message}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-10 text-muted-foreground">
                        No import issues detected.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg border">
          <div className="flex items-center gap-3">
            {totalChanges > 0 ? (
              <div className="p-2 bg-green-100 rounded-full">
                <CheckCircle className="text-green-600 h-6 w-6" />
              </div>
            ) : (
              <div className="p-2 bg-slate-100 rounded-full">
                <Info className="text-slate-600 h-6 w-6" />
              </div>
            )}

            <div>
              <p className="font-bold">
                {totalChanges > 0 ? 'Changes Detected' : 'No Changes Found'}
              </p>
              <p className="text-xs text-muted-foreground">Profile: {result.profileName}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setDryRun(null)}>
              Discard
            </Button>
            <Button
              onClick={handleFinalPublish}
              disabled={isPublishing || totalChanges === 0}
            >
              {isPublishing ? (
                <Spinner />
              ) : (
                <>
                  <RotateCw className="mr-2 h-4 w-4" /> Publish Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Shift Importer</h2>
      </div>

      {!dryRun ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Upload Gas Planner</CardTitle>
              <CardDescription>
                Upload your Gas planner. Only Today and Future shifts will be affected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FileUploader
                onImportComplete={handleImportComplete}
                onFileSelect={() => setDryRun(null)}
                userProfile={userProfile}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upload Build Planner</CardTitle>
              <CardDescription>
                Upload your Build planner. Only Today and Future shifts will be affected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FileUploader
                onImportComplete={handleImportComplete}
                onFileSelect={() => setDryRun(null)}
                userProfile={userProfile}
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        renderDryRunResults(dryRun)
      )}
    </div>
  );
}
