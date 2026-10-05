"use client";

import {
  createKnowledgeEntrySchema,
  KNOWLEDGE_CONTENT_MAX,
  KNOWLEDGE_MAX_ENTRIES,
  updateKnowledgeEntrySchema,
  type KnowledgeEntryItem,
  type KnowledgeListResponse,
  type KnowledgeStatusFilter,
} from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Badge } from "@arthur-ai/ui/components/badge";
import { Button } from "@arthur-ai/ui/components/button";
import { Card } from "@arthur-ai/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@arthur-ai/ui/components/empty";
import { Input } from "@arthur-ai/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@arthur-ai/ui/components/native-select";
import { Textarea } from "@arthur-ai/ui/components/textarea";
import { BookOpen, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { Field } from "@/components/field";
import { Pagination } from "@/components/pagination";
import { apiMutate } from "@/lib/api-client";
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from "@/lib/form-errors";
import { formatDateTime } from "@/lib/format";

interface Props {
  companyId: string;
  /** Rota desta página (admin ou painel da empresa), para busca e paginação. */
  basePath: string;
  data: KnowledgeListResponse;
  q: string;
  status: KnowledgeStatusFilter;
}

export function KnowledgeBaseManager({ companyId, basePath, data, q, status }: Props) {
  const [editing, setEditing] = useState<KnowledgeEntryItem | "new" | null>(null);
  const filtered = Boolean(q) || status !== "all";
  const params: Record<string, string> = {};
  if (q) params["q"] = q;
  if (status !== "all") params["status"] = status;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <form className="flex flex-col gap-2 sm:flex-row" role="search" action={basePath}>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="Buscar no título ou conteúdo" aria-label="Buscar informações" maxLength={100} className="pl-9" />
          </div>
          {data.canEdit ? (
            <NativeSelect name="status" defaultValue={status} aria-label="Filtrar por estado">
              <NativeSelectOption value="all">Todas</NativeSelectOption>
              <NativeSelectOption value="active">Ativas</NativeSelectOption>
              <NativeSelectOption value="inactive">Inativas</NativeSelectOption>
            </NativeSelect>
          ) : null}
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
          {filtered ? (
            <Button asChild variant="ghost">
              <Link href={basePath}>Limpar</Link>
            </Button>
          ) : null}
        </form>
        {data.canEdit && editing === null ? (
          <Button
            onClick={() => {
              setEditing("new");
            }}
          >
            <Plus /> Nova informação
          </Button>
        ) : null}
      </div>

      {!data.canEdit ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          Você pode consultar as informações ativas. Só o proprietário ou o administrador da empresa pode alterá-las.
        </p>
      ) : null}

      {editing === "new" ? (
        <EntryForm
          companyId={companyId}
          entry={null}
          onDone={() => {
            setEditing(null);
          }}
        />
      ) : null}

      {data.items.length === 0 ? (
        <Card className="gap-0 py-0">
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpen />
              </EmptyMedia>
              <EmptyTitle>{filtered ? "Nada encontrado" : "Nenhuma informação cadastrada"}</EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? "Tente outra busca."
                  : "Cadastre preços, serviços, horários, endereço e políticas. A IA só responde com o que estiver aqui."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-card">
          {data.items.map((item) =>
            editing !== null && editing !== "new" && editing.id === item.id ? (
              <li key={item.id} className="bg-subtle p-3">
                <EntryForm
                  companyId={companyId}
                  entry={item}
                  onDone={() => {
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={item.id}>
                <EntryCard
                  companyId={companyId}
                  item={item}
                  canEdit={data.canEdit}
                  onEdit={() => {
                    setEditing(item);
                  }}
                />
              </li>
            ),
          )}
        </ul>
      )}
      <Pagination basePath={basePath} page={data.page} pageSize={data.pageSize} total={data.total} params={params} />
    </div>
  );
}

function EntryCard({ companyId, item, canEdit, onEdit }: { companyId: string; item: KnowledgeEntryItem; canEdit: boolean; onEdit: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const path = `/companies/${companyId}/knowledge-base/${item.id}`;

  function run(action: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error?.message ?? "Não foi possível concluir a operação.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className={item.active ? "font-medium" : "font-medium text-muted-foreground"}>{item.title}</p>
            <Badge variant={item.active ? "success" : "neutral"}>{item.active ? "Ativa" : "Inativa"}</Badge>
            {item.category ? <Badge variant="outline">{item.category}</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Ordem {item.position} · atualizada em {formatDateTime(item.updatedAt)}
          </p>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEdit} disabled={pending}>
              <Pencil /> Editar
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => apiMutate("PATCH", path, { active: !item.active }))}>
              {item.active ? "Desativar" : "Ativar"}
            </Button>
            <ConfirmAction
              size="sm"
              triggerVariant="ghost"
              triggerClassName="text-destructive hover:bg-destructive-soft hover:text-destructive"
              label={
                <>
                  <Trash2 /> Excluir
                </>
              }
              title={`Excluir "${item.title}"?`}
              effect="A informação deixa de existir e a IA não poderá mais usá-la. Esta ação não pode ser desfeita."
              confirmLabel="Excluir"
              destructive
              pending={pending}
              onConfirm={() => run(() => apiMutate("DELETE", path))}
            />
          </div>
        ) : null}
      </div>
      <p className={expanded ? "text-sm whitespace-pre-wrap text-foreground/80" : "line-clamp-3 text-sm whitespace-pre-wrap text-foreground/80"}>{item.content}</p>
      {item.content.length > 240 || item.content.split("\n").length > 3 ? (
        <button
          type="button"
          className="text-xs font-medium text-brand-strong hover:underline"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          {expanded ? "Mostrar menos" : "Mostrar tudo"}
        </button>
      ) : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

function EntryForm({ companyId, entry, onDone }: { companyId: string; entry: KnowledgeEntryItem | null; onDone: () => void }) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = {
      title: form.get("title"),
      content: form.get("content"),
      category: form.get("category"),
      active: form.get("active") === "on",
      position: Number(form.get("position") || 0),
    };
    const parsed = entry ? updateKnowledgeEntrySchema.safeParse(raw) : createKnowledgeEntrySchema.safeParse(raw);
    setMessage(null);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = entry
        ? await apiMutate("PATCH", `/companies/${companyId}/knowledge-base/${entry.id}`, raw)
        : await apiMutate("POST", `/companies/${companyId}/knowledge-base`, raw);
      if (!result.ok) {
        setErrors(apiFieldErrors(result.error));
        setMessage(result.error.message);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <Card className="gap-0 px-5 py-4">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <p className="font-semibold">{entry ? "Editar informação" : "Nova informação"}</p>
        {message ? (
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-[1fr_200px_120px]">
          <Field id="title" label="Título" error={errors["title"]}>
            <Input id="title" name="title" defaultValue={entry?.title} maxLength={160} placeholder="Ex.: Preço do clareamento" />
          </Field>
          <Field id="category" label="Categoria" optional error={errors["category"]}>
            <Input id="category" name="category" defaultValue={entry?.category ?? ""} maxLength={60} placeholder="Ex.: Preços" />
          </Field>
          <Field id="position" label="Ordem" error={errors["position"]}>
            <Input id="position" name="position" type="number" min={0} defaultValue={entry?.position ?? 0} />
          </Field>
        </div>
        <Field
          id="content"
          label="Conteúdo"
          error={errors["content"]}
          hint={`Escreva como explicaria a um novo atendente. Até ${KNOWLEDGE_CONTENT_MAX.toLocaleString("pt-BR")} caracteres; até ${KNOWLEDGE_MAX_ENTRIES} informações por empresa.`}
        >
          <Textarea id="content" name="content" rows={6} maxLength={KNOWLEDGE_CONTENT_MAX} defaultValue={entry?.content} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={entry?.active ?? true} className="size-4 accent-primary" />
          Ativa (a IA pode usar)
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
