//
//  VebKorinish.swift
//  YO'LDA — Liquid Glass sinovi
//
//  yolda.uz ni ilova ichida ochadi.
//
//  IKKI NARSA QILINADI:
//
//    1. Veb ilovaning o'z pastki paneli yashiriladi — endi uning
//       o'rnida tizimning Liquid Glass paneli turadi. Saytning
//       o'zi o'zgarmaydi: uslub faqat shu ilova ichida qo'yiladi.
//
//    2. Ochilgandan keyin kerakli bo'limga o'tiladi. Veb ilovada
//       bo'lim `data-tab-link` tugmasi bilan almashadi — shu
//       tugmaning o'zi yasalib, bosiladi va olib tashlanadi.
//

import SwiftUI
import WebKit

struct VebKorinish: UIViewRepresentable {
  /// Veb ilovadagi bo'lim nomi: home, loads, order, life, profile.
  let tab: String

  func makeCoordinator() -> Coordinator { Coordinator(tab: tab) }

  func makeUIView(context: Context) -> WKWebView {
    let sozlama = WKWebViewConfiguration()

    // Pastki panelni yashiradigan uslub. `!important` kerak:
    // sahifaning o'z qoidalari ancha aniqroq yozilgan.
    let uslub = """
    var s = document.createElement('style');
    s.textContent = '.bottom-nav{display:none !important;}' +
      'main{padding-bottom:28px !important;}';
    document.head.appendChild(s);
    """
    sozlama.userContentController.addUserScript(
      WKUserScript(source: uslub, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

    let veb = WKWebView(frame: .zero, configuration: sozlama)
    veb.navigationDelegate = context.coordinator
    veb.scrollView.contentInsetAdjustmentBehavior = .never
    // Tizim paneli ortidan sahifa ko'rinib tursin.
    veb.isOpaque = false
    veb.backgroundColor = .clear
    veb.scrollView.backgroundColor = .clear

    if let manzil = URL(string: "https://yolda.uz/") {
      veb.load(URLRequest(url: manzil))
    }
    return veb
  }

  func updateUIView(_ uiView: WKWebView, context: Context) {}

  final class Coordinator: NSObject, WKNavigationDelegate {
    let tab: String
    init(tab: String) { self.tab = tab }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      // Bosh sahifa uchun hech narsa qilinmaydi — u allaqachon ochiq.
      guard tab != "home" else { return }
      let js = """
      (function(){
        var b = document.createElement('button');
        b.setAttribute('data-tab-link', '\(tab)');
        document.body.appendChild(b);
        b.click();
        b.remove();
      })();
      """
      webView.evaluateJavaScript(js, completionHandler: nil)
    }
  }
}
