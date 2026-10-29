//
//  RootView.swift
//  YO'LDA — Liquid Glass sinovi
//
//  Bu yerda hech qanday "shisha kodi" yo'q va bo'lishi ham shart
//  emas. iOS 26 SDK bilan yig'ilgan `TabView` ning pastki paneli
//  Liquid Glass bo'lib chiqadi — tizim uni o'zi chizadi.
//
//  Har bir bo'lim ichida yolda.uz ochiladi. Veb ilovaning O'Z
//  pastki paneli esa yashiriladi: aks holda ikkita panel ustma-ust
//  tushardi. Buning uchun saytga tegilmaydi — uslub faqat shu
//  ilova ichida, WKWebView orqali qo'yiladi.
//

import SwiftUI

/// Pastki paneldagi bo'limlar. `tab` — veb ilovaning o'z bo'lim
/// nomi (`data-tab-link`), `belgi` esa SF Symbols nomi.
struct Bolim: Hashable {
  let nom: String
  let belgi: String
  let tab: String
}

let BOLIMLAR: [Bolim] = [
  Bolim(nom: "Asosiy",      belgi: "house",              tab: "home"),
  Bolim(nom: "Yuklar",      belgi: "shippingbox",        tab: "loads"),
  Bolim(nom: "Yuk joylash", belgi: "plus.circle",        tab: "order"),
  Bolim(nom: "Life",        belgi: "play.circle",        tab: "life"),
  Bolim(nom: "Profil",      belgi: "person.crop.circle", tab: "profile"),
]

struct RootView: View {
  @State private var tanlangan: Int = 0

  var body: some View {
    TabView(selection: $tanlangan) {
      ForEach(Array(BOLIMLAR.enumerated()), id: \.offset) { indeks, bolim in
        VebKorinish(tab: bolim.tab)
          // Veb sahifa panel ostidan ham o'tib tursin: shunda
          // shishaning ortida HARAKAT bo'ladi va material
          // ko'rinadi. Panel ustiga suriladigan narsa bo'lmasa,
          // u oddiy kulrang chiziqday tuyulardi.
          .ignoresSafeArea(edges: .bottom)
          .tabItem {
            Label(bolim.nom, systemImage: bolim.belgi)
          }
          .tag(indeks)
      }
    }
  }
}

#Preview {
  RootView()
}
