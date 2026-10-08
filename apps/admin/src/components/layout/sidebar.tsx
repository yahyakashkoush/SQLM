'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  TicketPercent,
  Bell,
  Bitcoin,
  Bot,
  Boxes,
  ClipboardList,
  CreditCard,
  FileText,
  FolderTree,
  Gift,
  History,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  LogOut,
  Package,
  Receipt,
  Scale,
  Settings,
  Store,
  Truck,
  UserCog,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { cn } from '@sqlm/ui';
import type { Permission } from '@sqlm/shared';
import { useAuthStore } from '@/store/auth-store';
import { api } from '@/lib/api';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof Package;
  permission: Permission;
}

export const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Sales',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'orders.read' },
      { href: '/profits', label: 'Profits', icon: TrendingUp, permission: 'analytics.read' },
      { href: '/orders', label: 'Orders', icon: ClipboardList, permission: 'orders.read' },
      { href: '/payment-proofs', label: 'Payment Review', icon: Receipt, permission: 'payments.proofs.read' },
      { href: '/wallet', label: 'Wallet Top-ups', icon: Wallet, permission: 'payments.proofs.read' },
      { href: '/crypto-payments', label: 'Crypto Payments', icon: Bitcoin, permission: 'payments.proofs.read' },
      { href: '/deliveries', label: 'Deliveries', icon: Truck, permission: 'delivery.read' },
      { href: '/support', label: 'Support', icon: LifeBuoy, permission: 'support.read' },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { href: '/products', label: 'Products', icon: Package, permission: 'products.read' },
      { href: '/categories', label: 'Categories', icon: FolderTree, permission: 'categories.read' },
      { href: '/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory.read' },
      { href: '/delivery-templates', label: 'Delivery Templates', icon: LayoutTemplate, permission: 'delivery.read' },
      { href: '/coupons', label: 'Coupons', icon: TicketPercent, permission: 'coupons.read' },
      { href: '/social-rewards', label: 'Gift Rewards', icon: Gift, permission: 'orders.write' },
    ],
  },
  {
    title: 'Customers',
    items: [
      { href: '/customers', label: 'Customers', icon: Users, permission: 'customers.read' },
      { href: '/appeals', label: 'Appeals', icon: Scale, permission: 'customers.read' },
      { href: '/wholesale', label: 'Wholesale', icon: Store, permission: 'customers.read' },
      { href: '/old-customers', label: 'Old Customers', icon: History, permission: 'customers.read' },
      { href: '/notifications', label: 'Broadcast', icon: Bell, permission: 'settings.write' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { href: '/payment-methods', label: 'Payment Methods', icon: CreditCard, permission: 'payments.methods.read' },
      { href: '/bot', label: 'Telegram Bot', icon: Bot, permission: 'settings.read' },
      { href: '/settings', label: 'Settings & Content', icon: Settings, permission: 'settings.read' },
      { href: '/staff', label: 'Staff & Roles', icon: UserCog, permission: 'staff.read' },
      { href: '/audit-logs', label: 'Audit Logs', icon: FileText, permission: 'audit_logs.read' },
    ],
  },
];

export function navLabelFor(pathname: string): string {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return item.label;
    }
  }
  return 'SQLM Admin';
}

/**
 * Fixed rail on desktop; on phones the same panel slides in over the page
 * and closes itself once a link is tapped.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] transition-opacity md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] flex-col border-r bg-card shadow-xl transition-transform duration-200',
          'md:sticky md:top-0 md:z-auto md:h-screen md:w-60 md:translate-x-0 md:shadow-none',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">SQLM Admin</p>
            <p className="truncate text-xs text-muted-foreground">{staff?.name ?? ''}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{staff?.role ?? ''}</p>
          </div>
          <button
            onClick={onClose}
            className="-m-1 rounded-md p-2 text-muted-foreground hover:bg-accent md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain p-2">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => can(item.permission));
            if (items.length === 0) return null;
            return (
              <div key={section.title} className="mb-3">
                <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </p>
                {items.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onClose}
                      className={cn(
                        'mb-0.5 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors md:py-2',
                        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                    </Link>
                  );
                })}
              </div>
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
    </>
  );
}
