import { TEMPLATES } from "@/lib/site/templates";

export function GET() {
  return Response.json({ templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, features: t.features, requiredIntegrations: t.requiredIntegrations, defaultName: t.defaultName })) });
}
