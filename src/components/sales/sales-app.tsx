"use client";

// Sales: the menu, and which screen a path opens.
import { BadgePercent, ClipboardList, Handshake, Home, Settings, Tags, Truck, Undo2, Users } from "lucide-react";
import { ModuleFrame, isId } from "@/components/shell/module-frame";
import { OrderEditor, OrderPage, OrdersView } from "./orders";
import { CommissionsView, CustomersView, DeliveriesView, HomeView, PriceListPage, PriceListsView, ReturnsView, SettingsView } from "./more";
import { Empty, type Meta } from "./shared";

export function SalesApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="sales"
      base="sales"
      title="Sales"
      icon={<Handshake />}
      section={section}
      nav={(m) => [
        { id: "", label: "Home", icon: <Home /> },
        { id: "orders", label: "Orders", icon: <ClipboardList />, group: "Selling" },
        { id: "deliveries", label: "Deliveries", icon: <Truck />, hidden: !m.parts.delivery },
        { id: "returns", label: "Returns", icon: <Undo2 />, hidden: !m.parts.delivery },
        { id: "customers", label: "Customers", icon: <Users />, group: "Terms", hidden: !m.parts.pricing },
        { id: "price-lists", label: "Price lists", icon: <Tags />, hidden: !m.parts.pricing },
        { id: "commissions", label: "Commissions & targets", icon: <BadgePercent />, group: "People", hidden: !m.parts.commissions },
        { id: "settings", label: "Settings", icon: <Settings />, group: "Setup", hidden: !m.me.manage },
      ]}
      render={(m) => {
        const off = <Empty>This part of Sales is switched off for your workspace. An owner or admin can switch it on in Settings → Features.</Empty>;
        switch (section) {
          case "orders":
            return id === "new" ? <OrderEditor /> : isId(id) ? <OrderPage key={id} id={id!} /> : <OrdersView />;
          case "deliveries":
            return m.parts.delivery ? <DeliveriesView /> : off;
          case "returns":
            return m.parts.delivery ? <ReturnsView /> : off;
          case "customers":
            return m.parts.pricing ? <CustomersView /> : off;
          case "price-lists":
            return !m.parts.pricing ? off : isId(id) ? <PriceListPage key={id} id={id!} /> : <PriceListsView />;
          case "commissions":
            return m.parts.commissions ? <CommissionsView /> : off;
          case "settings":
            return m.me.manage ? <SettingsView /> : <Empty>Only workspace owners and admins can open this.</Empty>;
          default:
            return <HomeView />;
        }
      }}
    />
  );
}
