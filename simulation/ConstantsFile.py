"""
ConstantsFile.py
================

Constantes del sistema para identificar tipos de tiles en Culture_vector.

Estos valores representan:
- EMPTY: Espacio vacío o célula muerta
- MEMBRANE: Membrana celular (capacitiva)
- TJ: Tight junction / Rb (resistiva)
"""

class SystemConst:
    """Constantes para identificar tipos de tiles en Culture_vector."""
    
    EMPTY = 0      # Espacio vacío / célula muerta
    MEMBRANE = 1   # Membrana celular
    APOTOSIS = [10,7,3.5,0]   # Apoptosis stages (1st→2nd→3rd→dead)
    TJ = 8         # Tight junction / intercellular resistance (Rb)
    
    @classmethod
    def describe(cls, value):
        """Retorna descripción del valor."""
        mapping = {
            cls.EMPTY: "Espacio vacío / célula muerta",
            cls.MEMBRANE: "Membrana celular (capacitiva)",
            cls.TJ: "Tight junction (resistiva Rb)"
        }
        return mapping.get(value, f"Desconocido ({value})")
    
    @classmethod
    def validate_vector(cls, Culture_vector):
        """Valida que Culture_vector solo tenga valores permitidos."""
        import numpy as np
        unique_values = np.unique(Culture_vector)
        valid = {cls.EMPTY, cls.MEMBRANE, cls.TJ}
        invalid = set(unique_values) - valid
        
        if invalid:
            print(f"⚠️  Valores no esperados en Culture_vector: {invalid}")
            print(f"   Valores válidos: {valid}")
            return False
        return True


# Para compatibilidad con código anterior que use nombres en minúsculas
EMPTY = SystemConst.EMPTY
MEMBRANE = SystemConst.MEMBRANE  
APOTOSIS = SystemConst.APOTOSIS
TJ = SystemConst.TJ
