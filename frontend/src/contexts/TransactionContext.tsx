import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TransactionItem } from "@/services/blockchain/types";

interface TransactionContextValue {
  transactions: TransactionItem[];
  pushTransaction: (transaction: Omit<TransactionItem, "id">) => string;
  updateTransaction: (id: string, transaction: Partial<Omit<TransactionItem, "id">>) => void;
  dismissTransaction: (id: string) => void;
}

const TransactionContext = createContext<TransactionContextValue | null>(null);

export function TransactionProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);

  const value = useMemo<TransactionContextValue>(
    () => ({
      transactions,
      pushTransaction: (transaction) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setTransactions((current) => [{ id, ...transaction }, ...current].slice(0, 4));
        window.setTimeout(() => {
          setTransactions((current) => current.filter((item) => item.id !== id));
        }, 3 * 60 * 1000);
        return id;
      },
      updateTransaction: (id, transaction) => {
        setTransactions((current) =>
          current.map((item) => (item.id === id ? { ...item, ...transaction } : item)),
        );
        if (transaction.status && /^(confirmed|failed|complete|completed|success)$/i.test(transaction.status)) {
          window.setTimeout(() => {
            setTransactions((current) => current.filter((item) => item.id !== id));
          }, 8_000);
        }
      },
      dismissTransaction: (id) => {
        setTransactions((current) => current.filter((transaction) => transaction.id !== id));
      },
    }),
    [transactions],
  );

  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
}

export function useTransactions() {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error("useTransactions must be used within a TransactionProvider");
  }
  return context;
}
