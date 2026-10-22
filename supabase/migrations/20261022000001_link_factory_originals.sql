-- Shared with the Humor Project: link each finished meme to its private upload.
-- Existing links and image bytes are preserved when this is applied again.
alter table public.images add column if not exists original_storage_path text;
alter table public.factory_batches add column if not exists original_storage_path text;
