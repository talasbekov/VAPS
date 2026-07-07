import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Button,
} from "my-v0-project";
import { Info } from "lucide-react";

export const Open = () => (
  <TooltipProvider delayDuration={0}>
    <div className="flex justify-center" style={{ paddingTop: 120 }}>
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Справка о статусе">
            <Info className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Сотрудник в командировке до 12.07.2026 (приказ №215-к)</p>
        </TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);
