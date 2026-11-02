import { X } from "lucide-react";
import { useTransactions } from "@/contexts/TransactionContext";

export function TransactionFeed() {
  const { transactions, dismissTransaction } = useTransactions();

  if (transactions.length === 0) {
    return null;
  }

  return (
    <aside className="fixed bottom-6 left-4 right-4 z-50 mx-auto w-auto max-w-sm space-y-3 sm:left-auto sm:right-6 sm:mx-0">
      {transactions.map((transaction) => (
        <div
          key={transaction.id}
          className="min-w-0 overflow-hidden rounded-3xl border border-border bg-background/95 p-4 shadow-lg shadow-black/5 backdrop-blur"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{transaction.title}</p>
              <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{transaction.description}</p>
            </div>
            <button
              type="button"
              onClick={() => dismissTransaction(transaction.id)}
              className="shrink-0 rounded-full p-1 text-muted-foreground transition hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>{transaction.status}</span>
            {transaction.explorerUrl ? (
              <a
                href={transaction.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                View
              </a>
            ) : null}
          </div>
        </div>
      ))}
    </aside>
  );
}
