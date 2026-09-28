import { Mail, MessageCircle, Phone } from "lucide-react";
import type { SupportContactsDto } from "@booking/shared";
import { Button } from "@/components/ui/button";

const waHref = (whatsapp: string) => `https://wa.me/${whatsapp.replace(/[^\d]/g, "")}`;

export const hasSupportContacts = (support: SupportContactsDto): boolean => Boolean(support.email || support.phone || support.whatsapp);

/** Contact buttons; only shows the channels that have been configured in Settings. Renders nothing if none are set. */
export function SupportInline({ support }: { support: SupportContactsDto }) {
  if (!hasSupportContacts(support)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {support.whatsapp && (
        <Button asChild size="sm" variant="outline">
          <a href={waHref(support.whatsapp)} target="_blank" rel="noreferrer">
            <MessageCircle className="size-4" /> WhatsApp
          </a>
        </Button>
      )}
      {support.phone && (
        <Button asChild size="sm" variant="outline">
          <a href={`tel:${support.phone}`}>
            <Phone className="size-4" /> {support.phone}
          </a>
        </Button>
      )}
      {support.email && (
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${support.email}`}>
            <Mail className="size-4" /> {support.email}
          </a>
        </Button>
      )}
    </div>
  );
}
