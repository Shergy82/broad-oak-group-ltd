'use client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Users } from "lucide-react";

export default function AdminDashboardPage() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
            <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>View and manage user roles and permissions.</CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild>
                    <Link href="/admin/users">
                        <Users className="mr-2 h-4 w-4" />
                        Go to User Management
                    </Link>
                </Button>
            </CardContent>
        </Card>
        {/* Future admin cards can be added here */}
    </div>
  );
}
