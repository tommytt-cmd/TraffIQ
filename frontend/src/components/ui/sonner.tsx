import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-center"
      duration={5000}
      closeButton
      toastOptions={{
        duration: 5000,
        style: { width: "calc(100vw - 2rem)", maxWidth: "calc(100vw - 2rem)" },
        classNames: {
          toast:
            "group toast max-w-[calc(100vw-2rem)] whitespace-normal break-words group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          title: "whitespace-normal break-words",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
