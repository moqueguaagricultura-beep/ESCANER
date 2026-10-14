# 📄 Escáner PRO A4

Una aplicación web progresiva (PWA) de escaneo de documentos A4 con corrección de perspectiva automática, filtros de imagen, y exportación a PDF.

## ✨ Características

- 📷 **Escaneo con cámara** — usa la cámara trasera del celular
- 🔍 **Detección automática** de documentos A4
- ✂️ **Corrección de perspectiva** automática
- 🎨 **Filtros**: Original, Blanco y Negro, Escala de grises, Mejorar, Mágico
- ☀️ **Ajuste de brillo y contraste**
- ↺↻ **Girar** páginas izquierda o derecha
- 🗂️ **Gestión de páginas** con miniaturas en tiempo real
- 📋 **Reordenar páginas** con drag & drop
- 📥 **Exportar a PDF A4** con nombre personalizado
- 📤 **Compartir** el PDF directamente desde el celular
- 📁 **Importar imágenes** de la galería
- ⚡ **Funciona offline** (PWA con Service Worker)
- 📲 **Instalable** en Android e iOS

## 🚀 Uso desde GitHub Pages

1. Abre `https://TU_USUARIO.github.io/NOMBRE_REPO/` en el celular
2. Acepta el permiso de cámara
3. Instala la app (menú del navegador → "Añadir a pantalla de inicio")

## 📲 Instalar en el celular

### Android (Chrome)
1. Abre la URL en Chrome
2. Toca el menú ⋮ → "Añadir a pantalla de inicio"

### iOS (Safari)
1. Abre la URL en Safari
2. Toca el botón Compartir → "Añadir a la pantalla de inicio"

## 🛠️ Generar íconos

Abre `generate_icons.html` en el navegador — descargará automáticamente todos los tamaños y guárdalos en la carpeta `icons/`.

## 🗂️ Estructura del proyecto

```
escaner-pro/
├── index.html          # App principal
├── style.css           # Estilos
├── app.js              # Lógica JavaScript
├── sw.js               # Service Worker (offline)
├── manifest.json       # PWA manifest
├── generate_icons.html # Generador de íconos
├── icons/              # Íconos PWA (generar con generate_icons.html)
│   ├── icon-192.png
│   └── icon-512.png
│   └── ...
└── .github/
    └── workflows/
        └── deploy.yml  # Auto-deploy a GitHub Pages
```

## 📦 Despliegue en GitHub Pages (paso a paso)

1. **Crear repositorio** en GitHub (puede ser público o privado con Pages activado)
2. **Subir todos los archivos** de este proyecto
3. Ir a **Settings → Pages → Source → GitHub Actions**
4. El workflow `.github/workflows/deploy.yml` se ejecutará automáticamente
5. En unos segundos la app estará disponible en la URL de Pages

## ⚙️ Tecnologías usadas

- HTML5 Canvas API (procesamiento de imágenes)
- MediaDevices API (acceso a cámara)
- [jsPDF](https://github.com/parallax/jsPDF) (generación de PDF)
- Web Share API (compartir PDF)
- Service Worker API (offline)

## 📄 Licencia

MIT
