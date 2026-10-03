/** Aviso padrão quando o usuário só consulta um grupo (o backend recusa a edição de qualquer forma). */
export function ReadOnlyNote({ who = "o proprietário ou alguém com esta permissão" }: { who?: string }) {
  return <p className="text-sm text-muted-foreground">Você pode consultar estas configurações. Somente {who} pode alterá-las.</p>;
}
