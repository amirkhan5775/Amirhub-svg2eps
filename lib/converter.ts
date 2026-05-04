import { GoogleGenAI } from "@google/genai";

export async function convertSvgToEps(
  svgContent: string, 
  width: number, 
  height: number,
  providedApiKey?: string
): Promise<string> {
  const apiKey = providedApiKey || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error("Gemini API key is not configured. Please enter your API key in the settings sidebar or configure NEXT_PUBLIC_GEMINI_API_KEY in the environment.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const systemInstruction = `You are a high-fidelity vector conversion engine specialized in Adobe Illustrator EPS 10.
Your goal is to transform SVG into valid, production-ready Encapsulated PostScript (EPS).

STRICT COMPATIBILITY RULES:
1. OUTPUT: ONLY RAW EPS CODE. No markdown, no commentary.
2. HEADER: Must follow this exact sequence:
   %!PS-Adobe-3.0 EPSF-3.0
   %%BoundingBox: 0 0 ${Math.round(width)} ${Math.round(height)}
   %%HiResBoundingBox: 0 0 ${width} ${height}
   %%Creator: VectorShift-PRO-V8
   %%LanguageLevel: 2
   %%EndComments

3. COORDINATE SYSTEM:
   - SVG origin is Top-Left. EPS origin is BOTTOM-LEFT.
   - MANDATORY: You must flip all Y coordinates: Y_EPS = ${height} - Y_SVG.
   - Every coordinate used in 'm', 'l', 'c' MUST be flipped.

4. PROLOG (Use these exact aliases):
   %%BeginProlog
   /m {moveto} bind def
   /l {lineto} bind def
   /c {curveto} bind def
   /h {closepath} bind def
   /rg {setrgbcolor} bind def
   /f {fill} bind def
   /s {stroke} bind def
   /w {setlinewidth} bind def
   %%EndProlog

5. DRAWING BLOCK:
   gsave
   [Vector Data Here: color rg, path ops (m/l/c/h), paint (f/s)]
   grestore
   showpage
   %%EOF

6. DATA INTEGRITY:
   - Every path must be painted: end it with either 'f' (fill) or 's' (stroke).
   - Before painting, set the color using 'r g b rg' where r,g,b are 0.0 to 1.0.
   - For strokes, set the width using 'width w' before 's'.
   - Avoid negative coordinates; scale all elements to stay within 0..${width} and 0..${height}.`;

  const prompt = `Convert this SVG to high-quality AI EPS 10.
Dimensions: ${width}x${height}
Strict Requirement: Flip Y-axis to Bottom-Left origin.

SVG:
${svgContent}`;

  try {
    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
      }
    });

    let rawText = result.text || "";

    if (!rawText) {
      throw new Error("No output generated from engine");
    }
    
    // Remove potential markdown code blocks
    rawText = rawText.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");

    // Find the start and end of the EPS content
    const startIndex = rawText.indexOf("%!PS");
    const endIndex = rawText.lastIndexOf("%%EOF");

    let eps = rawText;
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      eps = rawText.substring(startIndex, endIndex + 5);
    } else if (startIndex !== -1) {
      eps = rawText.substring(startIndex);
    }

    return eps.trim();
  } catch (error: any) {
    console.error("Client-side Conversion Error:", error);
    throw new Error(error.message || "Engine failure during conversion");
  }
}
