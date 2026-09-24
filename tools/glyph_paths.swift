// Контуры армянских букв из Noto Sans Armenian (лицензия OFL) в SVG-пути — основа для карандашных заголовков и анимации букв.
//   swift tools/glyph_paths.swift "Կուկուռուզնիկ" [--bold]      -> JSON: [{ch, adv, d}], координаты в em*1000, y вниз
import Foundation
import CoreText

let args = CommandLine.arguments
let text = args.count > 1 ? args[1] : "Ա"
let url = URL(fileURLWithPath: "/System/Library/Fonts/NotoSansArmenian.ttc") as CFURL
guard let descs = CTFontManagerCreateFontDescriptorsFromURL(url) as? [CTFontDescriptor], !descs.isEmpty else { print("[]"); exit(1) }
// выбираем начертание: Regular или Bold
func styleName(_ d: CTFontDescriptor) -> String { (CTFontDescriptorCopyAttribute(d, kCTFontStyleNameAttribute) as? String) ?? "" }
let want = args.contains("--bold") ? "Bold" : "Regular"
let desc = descs.first(where: { styleName($0) == want }) ?? descs[0]
let size: CGFloat = 1000
let font = CTFontCreateWithFontDescriptor(desc, size, nil)
var out: [[String: Any]] = []
for u in text.unicodeScalars {
    var chars = [UniChar](String(u).utf16)
    var glyphs = [CGGlyph](repeating: 0, count: chars.count)
    CTFontGetGlyphsForCharacters(font, &chars, &glyphs, chars.count)
    var adv = CGSize.zero
    CTFontGetAdvancesForGlyphs(font, .horizontal, &glyphs, &adv, 1)
    var d = ""
    if let path = CTFontCreatePathForGlyph(font, glyphs[0], nil) {
        path.applyWithBlock { e in
            let el = e.pointee; let p = el.points
            func f(_ v: CGFloat) -> String { String(format: "%.1f", v) }
            switch el.type {
            case .moveToPoint: d += "M\(f(p[0].x)) \(f(-p[0].y))"
            case .addLineToPoint: d += "L\(f(p[0].x)) \(f(-p[0].y))"
            case .addQuadCurveToPoint: d += "Q\(f(p[0].x)) \(f(-p[0].y)) \(f(p[1].x)) \(f(-p[1].y))"
            case .addCurveToPoint: d += "C\(f(p[0].x)) \(f(-p[0].y)) \(f(p[1].x)) \(f(-p[1].y)) \(f(p[2].x)) \(f(-p[2].y))"
            case .closeSubpath: d += "Z"
            @unknown default: break
            }
        }
    }
    out.append(["ch": String(u), "adv": Double(adv.width), "d": d])
}
let data = try! JSONSerialization.data(withJSONObject: out, options: [])
print(String(data: data, encoding: .utf8)!)
