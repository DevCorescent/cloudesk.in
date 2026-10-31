import { expect, it } from "vitest";
import { templateSpec, TEMPLATES } from "@/lib/site/templates";
it("industries", () => {
  for (const id of ["patisserie","fine-dining","bar-lounge","hair-salon","makeup-studio","multispecialty-clinic","physio","skin-clinic","eye-clinic","yoga-studio","boxing-gym"]) {
    const s = templateSpec(TEMPLATES.find((t) => t.id === id)!);
    console.log(id, "→", s.industry, s.personality, s.pages.map((p) => p.path).join(" "));
  }
  expect(1).toBe(1);
});
