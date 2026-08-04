-- Reviewed public RSS/Atom and sitemap-to-JSON-LD connector families.

alter type public.connector_kind add value if not exists 'custom_feed' after 'custom_jsonld';
alter type public.connector_kind add value if not exists 'custom_sitemap' after 'custom_feed';
