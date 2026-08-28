{
  "targets": [
    {
      "target_name": "surface_layer",
      "sources": [],
      "conditions": [
        ["OS==\"mac\"", {
          "sources": [ "surface_layer.mm" ],
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "OTHER_CPLUSPLUSFLAGS": [ "-std=c++17" ]
          },
          "link_settings": {
            "libraries": [
              "$(SDKROOT)/System/Library/Frameworks/Cocoa.framework",
              "$(SDKROOT)/System/Library/Frameworks/IOSurface.framework",
              "$(SDKROOT)/System/Library/Frameworks/QuartzCore.framework",
              "$(SDKROOT)/System/Library/Frameworks/Metal.framework"
            ]
          }
        }],
        ["OS==\"win\"", {
          "sources": [ "surface_layer_win.cc" ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1
            }
          },
          "defines": [
            "NOMINMAX",
            "WIN32_LEAN_AND_MEAN",
            "_WIN32_WINNT=0x0A00"
          ]
        }],
        ["OS==\"linux\"", {
          "sources": [ "surface_layer_linux.cc" ],
          "cflags_cc": [ "-std=c++17", "-fexceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ]
        }]
      ]
    }
  ]
}
