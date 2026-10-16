export type DemoOrder = {
  id: string;
  customer: string;
  date: string;
  amount: number;
  status: "Selesai" | "Diproses" | "Menunggu";
};

export const demoOrders: DemoOrder[] = [
  { id: "TRX-2409", customer: "Nadia Putri", date: "Hari ini, 10:42", amount: 185000, status: "Selesai" },
  { id: "TRX-2408", customer: "Bagas Pratama", date: "Hari ini, 10:18", amount: 96000, status: "Diproses" },
  { id: "TRX-2407", customer: "Ayu Lestari", date: "Hari ini, 09:56", amount: 245000, status: "Selesai" },
  { id: "TRX-2406", customer: "Dimas Saputra", date: "Hari ini, 09:31", amount: 72000, status: "Menunggu" },
  { id: "TRX-2405", customer: "Rina Maharani", date: "Hari ini, 09:02", amount: 156000, status: "Selesai" },
  { id: "TRX-2404", customer: "Farhan Akbar", date: "Hari ini, 08:45", amount: 128000, status: "Diproses" },
  { id: "TRX-2403", customer: "Sinta Dewi", date: "Hari ini, 08:17", amount: 89000, status: "Selesai" },
  { id: "TRX-2402", customer: "Rizky Ramadhan", date: "Hari ini, 07:52", amount: 210000, status: "Selesai" },
];

export const demoRevenue = [
  { day: "Sen", revenue: 37, orders: 24 },
  { day: "Sel", revenue: 53, orders: 39 },
  { day: "Rab", revenue: 45, orders: 33 },
  { day: "Kam", revenue: 69, orders: 48 },
  { day: "Jum", revenue: 58, orders: 43 },
  { day: "Sab", revenue: 84, orders: 61 },
  { day: "Min", revenue: 73, orders: 55 },
];
