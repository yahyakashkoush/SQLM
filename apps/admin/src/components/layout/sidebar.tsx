'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  Bot,
  Boxes,
  ClipboardList,
  CreditCard,
  FileText,
  FolderTree,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  LogOut,
  Package,
  Receipt,
  Settings,
  Truck,
  UserCog,
  Users,
} from 'lucide-react';
import { cn } from '@sqlm/ui';
import type { Permission } from '@sqlm/shared';
import { useAuthStore } from '@/store/auth-store';
import { api } from '@/lib/api';

const NAV: Array<{ href: string; label: string; icon: typeof Package; permission: Permission }> = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'orders.read' },
  { href: '/orders', label: 'Orders', icon: ClipboardList, permission: 'orders.read' },
  { href: '/payment-proofs', label: 'Payment Review', icon: Receipt, permission: 'payments.proofs.read' },
  { href: '/deliveries', label: 'Deliveries', icon: Truck, permission: 'delivery.read' },
  { href: '/support', label: 'Support', icon: LifeBuoy, permission: 'support.read' },
  { href: '/products', label: 'Products', icon: Package, permission: 'products.read' },
  { href: '/categories', label: 'Categories', icon: FolderTree, permission: 'categories.read' },
  { href: '/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory.read' },
  { href: '/delivery-templates', label: 'Delivery Templates', icon: LayoutTemplate, permission: 'delivery.read' },
  { href: '/payment-methods', label: 'Payment Methods', icon: CreditCard, permission: 'payments.methods.read' },
  { href: '/customers', label: 'Customers', icon: Users, permission: 'customers.read' },
  { href: '/notifications', label: 'Broadcast', icon: Bell, permission: 'settings.write' },
  { href: '/bot', label: 'Telegram Bot', icon: Bot, permission: 'settings.read' },
  { href: '/settings', label: 'Settings', icon: Settings, permission: 'settings.read' },
  { href: '/staff', label: 'Staff & Roles', icon: UserCog, permission: 'staff.read' },
  { href: '/audit-logs', label: 'Audit Logs', icon: FileText, permission: 'audit_logs.read' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const staff = useAuthStore((s) => s.staff);
  const can = useAuthStore((s) => s.can);
  const clearSession = useAuthStore((s) => s.clearSession);
  const refreshToken = useAuthStore((s) => s.refreshToken);

  const handleLogout = async () => {
    if (refreshToken) await api.logout(refreshToken).catch(() => undefined);
    clearSession();
    router.push('/login');
  };

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-card">
      <div className="border-b p-4">
        <p className="text-sm font-semibold">SQLM Admin</p>
        <p className="truncate text-xs text-muted-foreground">{staff?.name ?? ''}</p>
        <p className="text-xs text-muted-foreground">{staff?.role ?? ''}</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {NAV.filter((item) => can(item.permission)).map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'mb-0.5 flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={() => void handleLogout()}
        className="flex items-center gap-2 border-t p-4 text-sm text-muted-foreground hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </aside>
  );
}
