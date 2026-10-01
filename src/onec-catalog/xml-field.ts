export type XmlScalarSource = "attribute" | "text";

export type XmlScalarReadResult =
  | { kind: "absent" }
  | { kind: "value"; raw: string; source: XmlScalarSource }
  | { kind: "ambiguous"; attributeRaw: string; textRaw: string };

/** Read a scalar field from attribute and/or element text. Attribute wins when text is empty. */
export function readXmlScalar(
  attributeName: string,
  attributes: Record<string, string>,
  textValue: string,
): XmlScalarReadResult {
  const attributePresent = Object.prototype.hasOwnProperty.call(attributes, attributeName);
  const attributeRaw = attributePresent ? (attributes[attributeName] ?? "").trim() : "";
  const textRaw = textValue.trim();
  const hasText = textRaw.length > 0;

  if (attributePresent && hasText && attributeRaw !== textRaw) {
    return { kind: "ambiguous", attributeRaw, textRaw };
  }
  if (attributePresent) {
    return { kind: "value", raw: attributeRaw, source: "attribute" };
  }
  if (hasText) {
    return { kind: "value", raw: textRaw, source: "text" };
  }
  return { kind: "absent" };
}
