import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectOption {
  value: string;
  label: string;
  description?: string;
  highlight?: boolean;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function CustomSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select an option',
  className,
  disabled = false,
}: CustomSelectProps) {
  const selectedOption = options.find((opt) => opt.value === value);
  const renderPreview = (icon?: React.ReactNode, compact = false) => {
    if (!icon) return null;
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-white/5',
          compact ? 'h-7 w-11' : 'h-10 w-16'
        )}
      >
        {icon}
      </span>
    );
  };

  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={cn(
          "flex min-h-[48px] w-full items-center justify-between gap-2 rounded-lg border bg-card/60 px-3 py-2 text-sm transition-all outline-none focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
          selectedOption?.highlight 
            ? "border-sky-500/50 hover:border-sky-500/70 shadow-[0_0_10px_rgba(14,165,233,0.1)]" 
            : "border-border/70 hover:border-border hover:bg-card/80",
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder}>
          {selectedOption && (
            <div className="flex min-w-0 items-center gap-2">
              {renderPreview(selectedOption.icon, true)}
              <div className="min-w-0 flex-1 text-left leading-tight">
                <span className={cn("block truncate font-medium", selectedOption.highlight && "text-sky-400")}>
                  {selectedOption.label}
                </span>
                {selectedOption.description ? (
                  <span className="block truncate text-[11px] text-foreground/45">
                    {selectedOption.description}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon>
          <ChevronDown className="w-4 h-4 opacity-50" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="relative z-50 min-w-[8rem] overflow-hidden rounded-lg border border-border/70 bg-card/95 text-foreground shadow-xl backdrop-blur-md animate-in fade-in-0 zoom-in-95"
          position="popper"
          sideOffset={5}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={cn(
                  "relative flex w-full cursor-default select-none rounded-md py-2.5 pl-2.5 pr-9 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                  option.highlight && "bg-sky-500/5 focus:bg-sky-500/10"
                )}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {renderPreview(option.icon)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {option.highlight && <Sparkles className="h-3.5 w-3.5 shrink-0 text-sky-400" />}
                      <span className={cn("truncate font-medium", option.highlight && "text-sky-400")}>
                        {option.label}
                      </span>
                    </div>
                    {option.description && (
                      <span className="mt-0.5 block truncate text-xs text-foreground/50">
                        {option.description}
                      </span>
                    )}
                  </div>
                </div>

                <span className="absolute right-2 top-2.5 flex h-3.5 w-3.5 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check className="h-4 w-4 text-sky-400" />
                  </SelectPrimitive.ItemIndicator>
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
