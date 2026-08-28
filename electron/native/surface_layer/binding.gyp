{
  "targets": [
    {
      "target_name": "surface_layer",
      "sources": [ "surface_layer.mm" ],
      "conditions": [
        ["OS==\"mac\"", {
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
        }]
      ]
    }
  ]
}
